const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const {act, create} = require('react-test-renderer');
const {DEFAULT_AI_MODELS} = require('../src/utils/aiModels');
const keyboardAvoidance = require('./keyboard-avoidance-mock.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;

function loadFields() {
  const filename = path.resolve(__dirname, '../src/components/AISettingsFields.tsx');
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const normal = mod.require.bind(mod);
  mod.require = name => name === 'react-native'
    ? {View: 'View', Text: 'Text', TextInput: 'TextInput', Pressable: 'Pressable', StyleSheet: {create: value => value}}
    : name === './KeyboardAvoidance' ? keyboardAvoidance : normal(name);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true,
  }}).outputText, filename);
  return mod.exports.default;
}

const findButton = (tree, label) => tree.root.findAllByType('Pressable').find(node => node.props.accessibilityLabel === label);

test('one tap selects and saves a model, then closes the dropdown', async () => {
  const Fields = loadFields(), calls = [];
  let tree;
  function Harness() {
    const [model, setModel] = React.useState(DEFAULT_AI_MODELS[0]);
    return React.createElement(Fields, {apiKey: '', model, models: DEFAULT_AI_MODELS, onApiKeyChange() {},
      onModelChange: async value => {calls.push(value); setModel(value); return true;}, onModelsChange: async () => true, onSave() {}});
  }
  await act(async () => {tree = create(React.createElement(Harness));});
  await act(async () => findButton(tree, `Selected AI model ${DEFAULT_AI_MODELS[0]}. Show model list`).props.onPress());
  await act(async () => findButton(tree, 'Select model gpt-4.1').props.onPress());
  assert.deepEqual(calls, ['gpt-4.1']);
  assert.ok(findButton(tree, 'Selected AI model gpt-4.1. Show model list'));
  await act(async () => tree.unmount());
});

test('add/remove persist the model list with selection and survive remount; failed save retains the draft', async () => {
  const Fields = loadFields(), writes = [];
  let stored = {model: DEFAULT_AI_MODELS[0], models: [...DEFAULT_AI_MODELS]};
  let failNextWrite = false, tree;
  function Harness() {
    const [state, setState] = React.useState(stored);
    const onModelsChange = async (models, selectedModel) => {
      writes.push({models, selectedModel});
      if (failNextWrite) {
        failNextWrite = false;
        setState(stored);
        return false;
      }
      stored = {model: selectedModel === undefined ? state.model : selectedModel, models};
      setState(stored);
      return true;
    };
    return React.createElement(Fields, {apiKey: '', model: state.model, models: state.models, onApiKeyChange() {},
      onModelChange: async value => {stored = {...stored, model: value}; setState(stored); return true;},
      onModelsChange, onSave() {}});
  }
  const mount = async () => act(async () => {tree = create(React.createElement(Harness));});
  await mount();
  await act(async () => findButton(tree, `Selected AI model ${stored.model}. Show model list`).props.onPress());
  await act(async () => tree.root.findByProps({accessibilityLabel: 'New AI model ID'}).props.onChangeText(' custom/model-v2 '));
  await act(async () => findButton(tree, 'Add AI model').props.onPress());
  assert.deepEqual(writes[0], {models: [...DEFAULT_AI_MODELS, 'custom/model-v2'], selectedModel: 'custom/model-v2'});
  assert.equal(stored.model, 'custom/model-v2');
  await act(async () => tree.unmount());

  await mount();
  await act(async () => findButton(tree, `Selected AI model ${stored.model}. Show model list`).props.onPress());
  assert.ok(findButton(tree, 'Remove model custom/model-v2'));
  await act(async () => findButton(tree, 'Remove model custom/model-v2').props.onPress());
  assert.deepEqual(writes[1], {models: [...DEFAULT_AI_MODELS], selectedModel: DEFAULT_AI_MODELS[0]});
  await act(async () => tree.unmount());

  await mount();
  await act(async () => findButton(tree, `Selected AI model ${stored.model}. Show model list`).props.onPress());
  await act(async () => tree.root.findByProps({accessibilityLabel: 'New AI model ID'}).props.onChangeText('not-saved/model'));
  failNextWrite = true;
  await act(async () => findButton(tree, 'Add AI model').props.onPress());
  assert.equal(tree.root.findByProps({accessibilityLabel: 'New AI model ID'}).props.value, 'not-saved/model');
  assert.equal(stored.models.includes('not-saved/model'), false);
  assert.equal(writes.length, 3);
  await act(async () => tree.unmount());
});
