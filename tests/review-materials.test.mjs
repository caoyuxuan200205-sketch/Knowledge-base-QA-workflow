import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { zipSync, strToU8 } from 'fflate';
registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith('@/') ? new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href : specifier, context);
} });
const { createReviewPassages, createReviewMaterialIndex } = await import('../lib/review-materials.ts');
const { readReviewDocument, extractDocxXml } = await import('../lib/review-material-reader.ts');
const { parseMachineReview, reviewInputKey, machineReviewStatus, needsMachineReview, applyReviewEvent, REVIEW_PROMPT_VERSION } = await import('../lib/qa-review.ts');
const { reviewQaItems } = await import('../lib/qa-review-service.ts');
const qa = { id: 'q1', question: '青铜鼎有多高？', answer: '高30厘米。', category: '文物信息', source: 'QA.xlsx · 第2行', status: '待审核', confidence: 1, updatedAt: '', evidence: [{ id: 'qae', source: 'QA.xlsx', text: '青铜鼎高30厘米。', kind: 'provided-qa' }] };
function document(id, sections, extra = {}) {
  return { id, fileName: `${id}.pdf`, size: 1024, selected: true, passages: createReviewPassages(id, sections.map((text, index) => ({ source: `${id}.pdf · 第 ${index + 1} 页`, text }))), warnings: [], incomplete: false, ...extra };
}
const source = document('档案', ['青铜鼎高20厘米，用于祭祀。', '该青铜鼎仅在特展期间展示，平日不开放。']);

test('matching replaces uploaded-QA pseudo evidence with relevant original text and nearby conditions', () => {
  const mapped = createReviewMaterialIndex([source]).match(qa);
  assert.equal(mapped.question, qa.question); assert.equal(mapped.answer, qa.answer); assert.equal(mapped.status, qa.status);
  assert.equal(mapped.evidence[0].kind, 'material');
  assert.match(mapped.evidence[0].text, /20厘米/);
  assert.ok(mapped.evidence.some(entry => /特展期间/.test(entry.text)));
  assert.match(mapped.evidence[0].source, /档案.pdf · 第 1 页/);
  assert.equal(mapped.evidenceNote, undefined);
  assert.equal(createReviewMaterialIndex([]).match(qa), qa);
});

test('filenames and answer text alone cannot turn unrelated material into evidence', () => {
  const unrelated = document('青铜鼎', ['海洋生态展介绍珊瑚礁。']);
  const mapped = createReviewMaterialIndex([unrelated]).match({ ...qa, source: '青铜鼎.pdf', answer: '海洋生态展介绍珊瑚礁。' });
  assert.ok(mapped.evidence.every(entry => entry.kind === 'provided-qa'));
  assert.match(mapped.evidenceNote, /未找到/);
  const result = parseMachineReview('{"verdict":"未发现明显问题"}', mapped, mapped.evidence);
  assert.equal(result.verdict, '依据不足');
});

test('deselected files are excluded and incomplete source pages remain uncertain', () => {
  assert.equal(createReviewMaterialIndex([{ ...source, selected: false }]).match(qa), qa);
  const mapped = createReviewMaterialIndex([{ ...source, incomplete: true }]).match(qa);
  assert.match(mapped.evidenceNote, /未提取/);
  assert.equal(parseMachineReview('{"verdict":"未发现明显问题"}', mapped, mapped.evidence).verdict, '依据不足');
});

test('matching bounds input, preserves overlapping text, and does not silently truncate original chunks', () => {
  const long = '青铜鼎的介绍和限定条件。'.repeat(1000);
  const material = document('长资料', [long]);
  const first = material.passages[0], second = material.passages[1];
  assert.equal(first.text.slice(1200), second.text.slice(0, 300));
  assert.ok(material.passages.every(entry => entry.text.length <= 1500 && !entry.truncated));
  assert.ok(createReviewMaterialIndex([material]).match(qa).evidence.length <= 8);
});

test('new material expires an old result; reusing the same material keeps it valid after reload', () => {
  const mapped = createReviewMaterialIndex([source]).match(qa);
  const reviewed = { ...mapped, machineReview: { inputKey: reviewInputKey(mapped), promptVersion: REVIEW_PROMPT_VERSION, status: 'complete', result: { verdict: '建议修改' } } };
  assert.equal(needsMachineReview(createReviewMaterialIndex(JSON.parse(JSON.stringify([source]))).match(reviewed)), false);
  const changed = document('新档案', ['青铜鼎高25厘米。']);
  assert.equal(machineReviewStatus(createReviewMaterialIndex([changed]).match(reviewed)), '结果已过期');
});

test('brief citations keep actual source locations, and forged citations are hidden', () => {
  const mapped = createReviewMaterialIndex([source]).match(qa);
  const value = { verdict: '建议修改', summary: '原文为20厘米，答案写成30厘米。', citations: [{ evidenceId: mapped.evidence[0].id, quote: '高20厘米', source: '伪造的来源' }] };
  const result = parseMachineReview(JSON.stringify(value), mapped, mapped.evidence);
  assert.equal(result.verdict, '建议修改');
  assert.equal(result.citations[0].source, mapped.evidence[0].source);
  value.citations[0].quote = '高999厘米';
  const forged = parseMachineReview(JSON.stringify(value), mapped, mapped.evidence);
  assert.equal(forged.verdict, '依据不足'); assert.deepEqual(forged.citations, []);
  assert.throws(() => parseMachineReview(JSON.stringify({ ...value, citations: [...value.citations, ...value.citations, ...value.citations] }), mapped, mapped.evidence), /最多/);
});

test('TXT upload keeps qualifications and paragraph positions; empty and unsupported files report errors', async () => {
  const uploaded = await readReviewDocument(new File(['青铜鼎高20厘米。\n\n拟于明年开放展厅。'], '馆方资料.txt'));
  assert.equal(uploaded.error, undefined); assert.equal(uploaded.passages.length, 2);
  assert.match(uploaded.passages[1].text, /拟于明年/); assert.match(uploaded.passages[1].source, /第 2 段/);
  assert.match((await readReviewDocument(new File(['   '], '空白.txt'))).error, /没有提取/);
  assert.match((await readReviewDocument(new File(['legacy'], '原文.doc'))).error, /另存为/);
});

test('DOCX reader extracts only the document XML and rejects corrupt or unsupported archives', () => {
  const xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>青铜鼎高20厘米。</w:t></w:r></w:p></w:body></w:document>';
  const zip = zipSync({ 'word/document.xml': strToU8(xml), 'word/media/image.png': new Uint8Array(32) });
  assert.equal(extractDocxXml(zip), xml);
  assert.throws(() => extractDocxXml(zipSync({ 'unrelated.txt': strToU8('hello') })), /无法读取/);
  assert.throws(() => extractDocxXml(new Uint8Array([1, 2, 3])));
});

test('review sends matched original passages and saves checked citations without changing the QA', async context => {
  let current = createReviewMaterialIndex([source]).match(qa);
  const model = { id: 'r', name: 'Reviewer', modelId: 'test', provider: 'test', enabled: true, protocol: 'openai-chat-completions', baseUrl: 'https://example.invalid/chat/completions', maxInputTokens: 128000, maxOutputTokens: 8000, capabilities: { structuredOutput: true } };
  context.mock.method(globalThis, 'fetch', async (_url, init) => {
    const body = JSON.parse(init.body), input = JSON.parse(body.messages[1].content);
    assert.equal(input.answer, '高30厘米。');
    assert.equal(input.evidence[0].kind, 'material');
    assert.match(input.evidence[0].text, /高20厘米/);
    return Response.json({ choices: [{ message: { content: JSON.stringify({ verdict: '建议修改', summary: '原文为20厘米。', citations: [{ evidenceId: input.evidence[0].id, quote: '高20厘米' }] }) } }] });
  });
  await reviewQaItems([current], model, 'test-placeholder', (_id, review) => { current = applyReviewEvent(current, review); });
  assert.equal(current.machineReview.result.verdict, '建议修改');
  assert.match(current.machineReview.result.citations[0].source, /第 1 页/);
  assert.equal(current.answer, qa.answer); assert.equal(current.status, '待审核');
});
