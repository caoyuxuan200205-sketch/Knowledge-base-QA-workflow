import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith('@/') ? new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href : specifier, context);
} });
const { LOCAL_RULES, restoreModelAssignments, resolveModelAssignment } = await import('../lib/model-assignments.ts');
const { defaultModels } = await import('../lib/model-registry.ts');
const { callModel } = await import('../lib/llm-adapter.ts');
const models = defaultModels.slice(0, 2).map((model, i) => ({ ...model, id: `model-${i}`, modelId: `remote-${i}`, baseUrl: `https://example.invalid/provider-${i}/chat/completions` }));
const keyFor = (id) => `test-placeholder-${id}`;

test('legacy global selection migrates to production roles, not to machine review', () => {
  assert.deepEqual(restoreModelAssignments(undefined, 'old-model'), {
    qaGeneration: 'old-model', qaReview: '', evaluationGeneration: 'old-model',
  });
});

test('saved role assignments survive reload and override legacy settings', () => {
  const saved = { qaGeneration: 'model-0', qaReview: 'model-1', evaluationGeneration: LOCAL_RULES };
  assert.deepEqual(restoreModelAssignments(JSON.parse(JSON.stringify(saved)), 'old-model'), saved);
  assert.deepEqual(restoreModelAssignments({ qaGeneration: '' }, 'old-model'), {
    qaGeneration: '', qaReview: '', evaluationGeneration: '',
  });
});

test('invalid saved fields are unconfigured; local rules cannot stand in for QA review', () => {
  assert.deepEqual(restoreModelAssignments({ qaGeneration: 42, qaReview: LOCAL_RULES, evaluationGeneration: null }), {
    qaGeneration: '', qaReview: '', evaluationGeneration: '',
  });
});

test('local rules are an explicit option with no model or secret access', () => {
  const result = resolveModelAssignment(LOCAL_RULES, models, () => assert.fail('Rules must not read model keys'));
  assert.equal(result.engine, 'rules');
  assert.equal(result.ready, true);
  assert.equal(result.model, undefined);
  assert.equal(result.apiKey, '');
});

test('missing or disabled models never fall back to another model', () => {
  for (const assignment of ['', 'deleted-model']) {
    const result = resolveModelAssignment(assignment, models, keyFor);
    assert.equal(result.ready, false);
    assert.equal(result.model, undefined);
    assert.equal(result.engine, 'model');
  }
  const result = resolveModelAssignment('model-0', [{ ...models[0], enabled: false }, models[1]], keyFor);
  assert.equal(result.ready, false);
  assert.equal(result.model.id, 'model-0');
  assert.match(result.issue, /停用/);
});

test('incomplete configuration and missing keys block model generation, not silently use rules', () => {
  const invalid = resolveModelAssignment('model-0', [{ ...models[0], modelId: '' }], keyFor);
  assert.equal(invalid.ready, false);
  assert.match(invalid.issue, /配置不完整/);
  const noKey = resolveModelAssignment('model-0', models, () => '  ');
  assert.equal(noKey.ready, false);
  assert.equal(noKey.engine, 'model');
  assert.match(noKey.issue, /API Key/);
});

test('changing evaluation assignment leaves QA and review selections unchanged', () => {
  const initial = restoreModelAssignments(undefined, 'model-0');
  const changed = { ...initial, evaluationGeneration: 'model-1' };
  assert.equal(changed.qaGeneration, initial.qaGeneration);
  assert.equal(changed.qaReview, initial.qaReview);
  assert.equal(resolveModelAssignment(changed.evaluationGeneration, models, keyFor).model.id, 'model-1');
});

test('separate role selections send their own model ID, URL and key (mock requests only)', async (context) => {
  const requests = [];
  context.mock.method(globalThis, 'fetch', async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return Response.json({ choices: [{ message: { content: 'ok' } }] });
  });
  const roles = { qaGeneration: 'model-0', qaReview: 'model-1', evaluationGeneration: 'model-1' };
  for (const purpose of ['qaGeneration', 'evaluationGeneration']) {
    const resolved = resolveModelAssignment(roles[purpose], models, keyFor);
    assert.equal(resolved.ready, true);
    await callModel(resolved.model, resolved.apiKey, [{ role: 'user', content: 'test' }]);
  }
  assert.equal(requests.length, 2, 'Configuring the review role must not initiate a call');
  for (let index = 0; index < 2; index++) {
    assert.equal(requests[index].modelId, models[index].modelId);
    assert.equal(requests[index].url, models[index].baseUrl);
    assert.equal(requests[index].apiKey, keyFor(models[index].id));
  }
});
