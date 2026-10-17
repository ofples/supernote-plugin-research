const {test} = require('node:test');
const assert = require('node:assert/strict');
const {DEFAULT_AI_MODELS, normalizeAIModels, addAIModel, removeAIModel} = require('../src/utils/aiModels');

test('model list preserves supported examples, custom IDs, and legacy selected model', () => {
  assert.deepEqual(normalizeAIModels(['custom-model', 'gpt-4.1-mini'], 'old-saved-model'),
    ['custom-model', 'gpt-4.1-mini', 'old-saved-model']);
  assert.deepEqual(normalizeAIModels(undefined, 'old-saved-model'), [...DEFAULT_AI_MODELS, 'old-saved-model']);
  assert.deepEqual(normalizeAIModels([], 'old-saved-model'), ['old-saved-model']);
  assert.deepEqual(normalizeAIModels([], ''), []);
  assert.deepEqual(DEFAULT_AI_MODELS, ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini']);
});

test('users can add arbitrary IDs and remove saved IDs without duplicates', () => {
  const added = addAIModel(['custom-model'], '  another/custom-id  ');
  assert.deepEqual(added, ['custom-model', 'another/custom-id']);
  assert.deepEqual(addAIModel(added, 'custom-model'), added);
  assert.deepEqual(removeAIModel(added, 'custom-model'), ['another/custom-id']);
  assert.deepEqual(removeAIModel(['last-model'], 'last-model'), []);
});
