const DEFAULT_AI_MODELS = ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini'];

function normalizeAIModels(models, currentModel) {
  const result = [];
  for (const model of [...(Array.isArray(models) ? models : []), currentModel]) {
    if (typeof model !== 'string') continue;
    const value = model.trim();
    if (value && !result.includes(value)) result.push(value);
  }
  return result.length ? result : [...DEFAULT_AI_MODELS];
}

function addAIModel(models, model) {
  const value = typeof model === 'string' ? model.trim() : '';
  return value ? normalizeAIModels([...models, value]) : normalizeAIModels(models);
}

function removeAIModel(models, model) {
  return normalizeAIModels(models.filter(item => item !== model));
}

module.exports = {DEFAULT_AI_MODELS, normalizeAIModels, addAIModel, removeAIModel};
