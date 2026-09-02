import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { runGenerationJobs } from '../lib/generation-control.ts';
registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith('@/') ? new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href : specifier, context);
} });
const { callModel } = await import('../lib/llm-adapter.ts');
const { generateQaWithModel } = await import('../lib/qa-model-service.ts');
const { generateEvaluationWithModel } = await import('../lib/evaluation-model-service.ts');
const { POST } = await import('../app/api/llm/route.ts');
const model = { id: 'test', name: 'Test', modelId: 'test', baseUrl: 'https://example.invalid/v1/chat/completions', maxOutputTokens: 1000, capabilities: { structuredOutput: false } };

test('server proxy preserves rate-limit status and retry-after for the review scheduler', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => Response.json({ error: { message: 'rate limited' } }, { status: 429, headers: { 'Retry-After': '5' } }));
  const result = await POST(new Request('https://local.invalid/api/llm', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: model.baseUrl, modelId: model.modelId, apiKey: 'test-placeholder', messages: [] }),
  }));
  assert.equal(result.status, 429);
  assert.equal(result.headers.get('retry-after'), '5');
  assert.equal((await result.json()).error.message, 'rate limited');
});
const qa = { id: 'q1', question: '长城有什么作用？', answer: '长城用于防御。', category: '文物信息', source: '测试原文', status: '待审核', confidence: 0.8, updatedAt: '' };
function waitUntilAborted(signal) {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}
function source() {
  return { id: 's', fileName: '测试资料.txt', extension: 'txt', sheets: [{ name: '正文', selected: true,
    mapping: { question: '', answer: '', name: '' }, rows: Array.from({ length: 60 }, (_, i) => ({ 正文: `青铜器${i}出土于古墓，表面有纹饰。` })) }] };
}

test('pre-cancelled QA/evaluation runs never call the model or emit initial batches', async (context) => {
  const controller = new AbortController(); controller.abort();
  const fetch = context.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected request'); });
  const emit = () => assert.fail('Unexpected batch');
  await assert.rejects(generateQaWithModel([source()], model, 'test-placeholder', undefined, emit, undefined, controller.signal), { name: 'AbortError' });
  await assert.rejects(generateEvaluationWithModel([qa], ['标准问答'], model, 'test-placeholder', undefined, emit, undefined, controller.signal), { name: 'AbortError' });
  assert.equal(fetch.mock.callCount(), 0);
});

test('QA stop cancels all in-flight requests, does not dispatch queued work, retains completed batch', { timeout: 3000 }, async (context) => {
  const controller = new AbortController();
  const signals = []; const batches = [];
  context.mock.method(globalThis, 'fetch', async (_url, options) => {
    signals.push(options.signal);
    if (signals.length === 1) return Response.json({ choices: [{ message: { content: JSON.stringify({ items: [{ question: qa.question, answer: qa.answer, sourceRows: [2] }] }) } }] });
    return waitUntilAborted(options.signal);
  });
  await assert.rejects(generateQaWithModel([source()], model, 'test-placeholder', undefined, (batch) => {
    if (batch.length) { batches.push(...batch); controller.abort(); }
  }, undefined, controller.signal), { name: 'AbortError' });
  assert.equal(signals.length, 3);
  assert.ok(signals.every((signal) => signal.aborted));
  assert.equal(batches.length, 1);
  assert.equal(batches[0].question, qa.question);
});

test('evaluation stop retains baseline questions and aborts model requests', { timeout: 3000 }, async (context) => {
  const controller = new AbortController(); const batches = [];
  context.mock.method(globalThis, 'fetch', (_url, options) => {
    const pending = waitUntilAborted(options.signal);
    controller.abort();
    return pending;
  });
  await assert.rejects(generateEvaluationWithModel([qa], ['标准问答', '同义改写'], model, 'test-placeholder', undefined, (batch) => batches.push(...batch), undefined, controller.signal), { name: 'AbortError' });
  assert.equal(batches.length, 1);
  assert.equal(batches[0].dimension, '标准问答');
});

test('late response body after cancellation cannot publish QA', async (context) => {
  const controller = new AbortController(); let published = 0;
  context.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => {
    controller.abort();
    return { choices: [{ message: { content: '{"items":[{"question":"迟到的问题","answer":"不得入库"}]}' } }] };
  } }));
  await assert.rejects(generateQaWithModel([source()], model, 'test-placeholder', undefined, (batch) => { published += batch.length; }, undefined, controller.signal), { name: 'AbortError' });
  assert.equal(published, 0);
});

test('worker failure cancels siblings and settles them before run exits; new run is independent', { timeout: 3000 }, async () => {
  let settled = 0; let started = 0;
  await assert.rejects(runGenerationJobs([0, 1, 2, 3, 4], 3, async (job, signal) => {
    started++;
    try {
      if (job === 0) { await Promise.resolve(); throw new Error('模拟失败'); }
      await waitUntilAborted(signal);
    } finally { settled++; }
  }), /模拟失败/);
  assert.equal(started, 3);
  assert.equal(settled, 3);
  const results = [];
  await runGenerationJobs([1, 2], 1, async (job) => { results.push(job); });
  assert.deepEqual(results, [1, 2]);
});

test('adapter forwards abort signal and aborts without an API request if already stopped', async (context) => {
  const controller = new AbortController(); controller.abort();
  const fetch = context.mock.method(globalThis, 'fetch', () => assert.fail('Unexpected request'));
  await assert.rejects(callModel(model, 'test-placeholder', [], { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(fetch.mock.callCount(), 0);
});

test('server proxy forwards client disconnect to upstream and reports cancellation', { timeout: 3000 }, async (context) => {
  const controller = new AbortController(); let upstreamSignal;
  context.mock.method(globalThis, 'fetch', (_url, options) => {
    upstreamSignal = options.signal;
    const pending = waitUntilAborted(options.signal);
    controller.abort();
    return pending;
  });
  const response = await POST(new Request('http://localhost/api/llm', { method: 'POST', signal: controller.signal,
    body: JSON.stringify({ url: model.baseUrl, apiKey: 'test-placeholder', modelId: 'test', messages: [] }), headers: { 'Content-Type': 'application/json' } }));
  assert.equal(upstreamSignal.aborted, true);
  assert.equal(response.status, 499);
  assert.deepEqual(await response.json(), { error: '请求已取消' });
});
