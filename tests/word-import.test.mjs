import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { zipSync, strToU8 } from 'fflate';

registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith('@/') ? new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href : specifier, context);
} });
const { inspectSourceFile, generateQaFromParsedSources } = await import('../lib/museum-workflow.ts');
const { generateQaWithModel } = await import('../lib/qa-model-service.ts');

test('Word import reports legacy, corrupt, missing-body and oversized files without throwing', async () => {
  assert.match((await inspectSourceFile(new File(['legacy'], '资料.doc'))).error, /另存为 .docx/);
  for (const file of [
    new File(['broken zip'], '资料.docx'),
    new File([zipSync({ 'unrelated.txt': strToU8('hello') })], '资料.DOCX'),
  ]) {
    const parsed = await inspectSourceFile(file);
    assert.equal(parsed.extension, 'docx');
    assert.match(parsed.error, /Word 解析失败/);
    assert.deepEqual(parsed.sheets, []);
  }
  const oversized = await inspectSourceFile({ name: '大文件.docx', size: 21 * 1024 * 1024, arrayBuffer() { assert.fail('Must reject before reading'); } });
  assert.match(oversized.error, /20 MB/);
});

const original = '青铜鼎出土于汉墓，高20厘米，是重要的古代礼器，用于祭祀。';
const source = {
  id: 'word', fileName: '馆藏资料.docx', extension: 'docx', size: 1024,
  sheets: [{ name: '正文', headers: ['正文'], rows: [{ 正文: original }], selected: true, mapping: { question: '', answer: '', name: '' } }],
};

test('Word text uses the local text-generation path and retains original evidence', () => {
  const items = generateQaFromParsedSources([source]);
  assert.ok(items.length > 0);
  assert.ok(items.every(item => item.source.includes('馆藏资料.docx')));
  assert.ok(items.some(item => item.evidence.some(entry => entry.kind === 'material' && entry.text.includes('高20厘米'))));
  assert.deepEqual(generateQaFromParsedSources([{ ...source, sheets: [{ ...source.sheets[0], selected: false }] }]), []);
});

test('Word text reaches the model and generated QA keeps its source evidence', async context => {
  const model = { id: 'test', name: 'Test', modelId: 'test', provider: 'test', baseUrl: 'https://example.invalid/chat/completions', protocol: 'openai-chat-completions', enabled: true, maxInputTokens: 128000, maxOutputTokens: 8000, capabilities: { structuredOutput: true } };
  context.mock.method(globalThis, 'fetch', async (_url, init) => {
    const input = JSON.parse(JSON.parse(init.body).messages[1].content);
    assert.equal(input.sourceMetadataOnly.fileName, source.fileName);
    assert.equal(input.sourceRows[0]['正文'], original);
    return Response.json({ choices: [{ message: { content: JSON.stringify({ items: [{ question: '青铜鼎多高？', answer: '高20厘米。', sourceRows: [2] }] }) } }] });
  });
  const [qa] = await generateQaWithModel([source], model, 'test-placeholder');
  assert.equal(qa.status, '待审核');
  assert.equal(qa.evidence[0].kind, 'material');
  assert.equal(qa.evidence[0].text, `正文：${original}`);
  assert.match(qa.evidence[0].source, /馆藏资料.docx/);
});
