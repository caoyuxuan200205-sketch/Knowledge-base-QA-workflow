import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { cleanVisitorText, prepareVisitorRows, visitorQaInstructions } from '../lib/qa-source-policy.ts';

// Node 24 resolves app aliases and strips TypeScript without extra dependencies.
registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith('@/') ? new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href : specifier, context);
} });
const { generateQaFromParsedSources } = await import('../lib/museum-workflow.ts');
const { generateQaWithModel } = await import('../lib/qa-model-service.ts');
function source(rows, extension = 'pdf', mapping = { question: '', answer: '', name: '' }) {
  return { id: 'source-1', fileName: '忻州长城博物馆展陈大纲征求意见稿.pdf', extension, size: 10,
    sheets: [{ name: '第 1 页', selected: true, rows, headers: Object.keys(rows[0] ?? {}), mapping }] };
}
const model = { id: 'test-model', name: 'Test', modelId: 'test', provider: 'test', baseUrl: 'https://example.invalid/v1/chat/completions',
  protocol: 'openai-chat-completions', maxInputTokens: 10000, maxOutputTokens: 8000, enabled: true,
  capabilities: { structuredOutput: false, images: false, reasoning: false, toolCall: false } };

test('skips reported cover and date without mutating source', () => {
  const rows = [{ 正文: '忻州长城博物馆展陈大纲征求意见稿广东省集美设计工程有限公司忻州长城博物馆展陈工作组2024-12-20' }, { 正文: '编制日期：2024-12-20。' }];
  const before = JSON.stringify(rows);
  assert.deepEqual(prepareVisitorRows(rows), []);
  assert.equal(JSON.stringify(rows), before);
});
test('keeps facts from mixed page; removes page numbers and contents lines', () => {
  assert.equal(cleanVisitorText('编制单位：某设计公司。\n目录\n第一章……12\n第 2 页\n居庸关位于北京市昌平区，是长城沿线的重要关隘。'), '居庸关位于北京市昌平区，是长城沿线的重要关隘。');
});
test('document titles containing history/culture are not mistaken for historical facts', () => {
  assert.equal(cleanVisitorText('长城历史文化博物馆展陈大纲征求意见稿\n发布日期：2024-12-20。\n设计单位：历史文化研究院。'), '');
});
test('keeps manuscript authors, artifact dates and real opening dates', () => {
  const row = { 文物名称: '清代手稿', 作者: '张某', 年代: '清代', 出土时间: '1980年', 正文: '这份手稿记载了地方城防历史。' };
  assert.deepEqual(prepareVisitorRows([row])[0].row, row);
  for (const text of ['展览于2024年12月20日开幕。', '明代曾计划修建长城，以加强边防。', '这件藏品是清代地方志修订稿，记载了城防历史。']) assert.equal(cleanVisitorText(text), text);
});
test('skips planned facilities but retains adjacent history and confirmed hours', () => {
  assert.equal(cleanVisitorText('卫生间拟设置在二楼。长城始建于战国时期。'), '长城始建于战国时期。');
  assert.deepEqual(prepareVisitorRows([{ 开放时间: '暂定每周二至周日' }]), []);
  assert.deepEqual(prepareVisitorRows([{ 开放时间: '每周二至周日9:00—17:00' }])[0].row, { 开放时间: '每周二至周日9:00—17:00' });
});
test('removes document fields while preserving useful content and original row position', () => {
  const rows = [{ 名称: '展陈大纲征求意见稿', 发布日期: '2024-12-20', 编制单位: '某公司' }, { 名称: '展陈大纲征求意见稿', 发布日期: '2024-12-20', 正文: '居庸关位于北京市昌平区。', sourceRow: 999 }];
  assert.deepEqual(prepareVisitorRows(rows), [{ sourceRow: 3, row: { 正文: '居庸关位于北京市昌平区。' } }]);
});
test('local text generation skips cover and preserves original paragraph numbering', () => {
  const items = generateQaFromParsedSources([source([{ 正文: '忻州长城博物馆展陈大纲征求意见稿，编制日期2024年12月20日。' }, { 正文: '居庸关位于北京市昌平区，是明代京北长城沿线的重要关隘。' }])]);
  assert.equal(items.length, 1);
  assert.match(items[0].answer, /居庸关/);
  assert.match(items[0].source, /第 2 段/);
  assert.doesNotMatch(items[0].question, /征求意见稿/);
});
test('local structured material is cleaned but existing Excel QA remains unchanged', () => {
  assert.equal(generateQaFromParsedSources([source([{ 名称: '展陈大纲征求意见稿', 发布日期: '2024-12-20' }], 'xlsx')]).length, 0);
  const existing = { 问题: '征求意见稿的发布日期是什么？', 答案: '2024-12-20' };
  const items = generateQaFromParsedSources([source([existing], 'xlsx', { question: '问题', answer: '答案', name: '' })]);
  assert.equal(items[0].question, existing.问题);
  assert.equal(items[0].answer, existing.答案);
});
test('metadata-only input makes zero model calls', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected API call'); });
  assert.deepEqual(await generateQaWithModel([source([{ 正文: '编制单位：某设计公司。' }])], model, 'local-test-placeholder'), []);
});
test('model gets cleaned input, original row numbers and allows zero questions', async (context) => {
  const requests = [];
  context.mock.method(globalThis, 'fetch', async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return Response.json({ choices: [{ message: { content: '{"items":[]}' } }] });
  });
  const rows = Array.from({ length: 30 }, (_, i) => ({ 正文: i % 2 === 0 ? '编制日期：2024-12-20。' : `文物${i}出土于古墓，采用青铜铸造工艺。` }));
  assert.deepEqual(await generateQaWithModel([source(rows)], model, 'local-test-placeholder'), []);
  assert.equal(requests.length, 2);
  assert.match(requests[0].messages[0].content, /0至3/);
  assert.match(visitorQaInstructions, /不得围绕它们出题/);
  const preparedRows = requests.flatMap((request) => JSON.parse(request.messages[1].content).sourceRows);
  assert.deepEqual(preparedRows.map((row) => row.sourceRow), Array.from({ length: 15 }, (_, i) => i * 2 + 3));
  assert.ok(preparedRows.every((row) => !row.正文.includes('编制日期')));
});
test('no new post-generation quality filter is applied', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => Response.json({ choices: [{ message: { content: JSON.stringify({ items: [
    { question: '文件的发布日期是什么？', answer: '模拟输出，仅验证本阶段没有后置筛选。', sourceRows: [2] },
  ] }) } }] }));
  const items = await generateQaWithModel([source([{ 正文: '青铜器出土于古墓，表面有兽面纹。' }])], model, 'local-test-placeholder');
  assert.equal(items.length, 1);
  assert.equal(items[0].question, '文件的发布日期是什么？');
});
