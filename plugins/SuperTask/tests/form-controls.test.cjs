const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const {act, create} = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;

function load(file, overrides = {}) {
  const filename = path.resolve(__dirname, file);
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const normal = mod.require.bind(mod);
  mod.require = name => Object.hasOwn(overrides, name) ? overrides[name] : normal(name);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true},
  }).outputText, filename);
  return mod.exports;
}

function nativeMocks() {
  return {View: 'View', Text: 'Text', TextInput: 'TextInput', Pressable: 'Pressable', StyleSheet: {create: value => value}};
}

test('calendar shortcuts use local calendar arithmetic across month, year and leap-day boundaries', () => {
  const {addCalendarDays, formatDate} = load('../src/components/DatePicker.tsx', {
    'react-native': nativeMocks(), '../utils/debug': {log() {}}, '../utils/useFontScale': {useFontScale: () => 1},
  });
  assert.equal(formatDate(addCalendarDays(new Date(2026, 0, 31), 1)), '2026-02-01');
  assert.equal(formatDate(addCalendarDays(new Date(2026, 11, 31), 1)), '2027-01-01');
  assert.equal(formatDate(addCalendarDays(new Date(2024, 1, 28), 1)), '2024-02-29');
  assert.equal(formatDate(addCalendarDays(new Date(2024, 1, 29), 1)), '2024-03-01');
});

test('shared calendar footer selects Tomorrow and dismisses', async () => {
  const Picker = load('../src/components/DatePicker.tsx', {
    'react-native': nativeMocks(), '../utils/debug': {log() {}}, '../utils/useFontScale': {useFontScale: () => 1},
  }).default;
  const changes = []; let closed = 0; let tree;
  await act(async () => {tree = create(React.createElement(Picker, {value: '', onChange: value => changes.push(value), onClose: () => {closed++;}}));});
  const tomorrow = tree.root.findAllByType('Pressable').find(node => node.findAllByType('Text').some(n => n.props.children === 'Tomorrow'));
  await act(async () => tomorrow.props.onPress());
  const now = new Date();
  const expected = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  assert.equal(changes[0], `${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, '0')}-${String(expected.getDate()).padStart(2, '0')}`);
  assert.equal(closed, 1);
  await act(async () => tree.unmount());
});

const projects = [{id: 'p', name: 'House'}, {id: 'q', name: 'Work'}];
const sections = [{id: 'ps', project_id: 'p', name: 'Garden'}];
const pickerOverrides = { 'react-native': nativeMocks(), '../utils/useFontScale': {useFontScale: () => 1} };

test('project controls wrap into separate selected collection choices and clear old collection via onChange contract', async () => {
  const Picker = load('../src/components/ProjectPicker.tsx', pickerOverrides).default;
  let state; let tree;
  function Form() {
    const [project, setProject] = React.useState('p'); const [section, setSection] = React.useState('ps');
    state = {project, section};
    return React.createElement(Picker, {projects, sections, selectedId: project, selectedSectionId: section,
      onChange: id => {if (id !== project) setSection(null); setProject(id);}, onSectionChange: setSection});
  }
  await act(async () => {tree = create(React.createElement(Form));});
  assert.equal(tree.root.findAllByProps({accessibilityLabel: 'Choose collection No collection'}).length, 1);
  assert.equal(tree.root.findAllByProps({accessibilityLabel: 'Choose collection Garden'}).length, 1);
  assert.equal(tree.root.findAllByType('Text').some(n => n.props.children === 'Collections'), false);
  await act(async () => tree.root.findByProps({accessibilityLabel: 'Choose project Work'}).props.onPress());
  assert.deepEqual(state, {project: 'q', section: null});
  assert.equal(tree.root.findAllByProps({accessibilityLabel: 'Choose collection Garden'}).length, 0);
  assert.equal(tree.root.findAllByProps({accessibilityLabel: 'New collection in Work'}).length, 1);
  await act(async () => tree.unmount());
});

test('New collection is explicit, cancel is inert, and Save selects the returned collection', async () => {
  const Picker = load('../src/components/ProjectPicker.tsx', pickerOverrides).default;
  const created = []; let chosenProject; let chosenSection; let tree;
  await act(async () => {tree = create(React.createElement(Picker, {projects, sections: [], selectedId: 'q', onChange: id => {chosenProject = id;},
    onSectionChange: id => {chosenSection = id;}, onCreateCollection: async (projectId, name) => {created.push([projectId, name]); return {id: 'new-1', name, project_id: projectId};}}));});
  assert.deepEqual(created, []);
  await act(async () => tree.root.findByProps({accessibilityLabel: 'New collection in Work'}).props.onPress());
  await act(async () => tree.root.findByProps({accessibilityLabel: 'New collection name'}).props.onChangeText('  Ideas  '));
  await act(async () => tree.root.findByProps({accessibilityLabel: 'Cancel new collection'}).props.onPress());
  assert.deepEqual(created, []);
  await act(async () => tree.root.findByProps({accessibilityLabel: 'New collection in Work'}).props.onPress());
  await act(async () => tree.root.findByProps({accessibilityLabel: 'New collection name'}).props.onChangeText('  Ideas  '));
  await act(async () => tree.root.findByProps({accessibilityLabel: 'Save new collection'}).props.onPress());
  assert.deepEqual(created, [['q', 'Ideas']]);
  assert.equal(chosenProject, 'q'); assert.equal(chosenSection, 'new-1');
  await act(async () => tree.unmount());
});

test('collection form lazily uses the offline service when no override callback is supplied', async () => {
  const calls = [];
  const Picker = load('../src/components/ProjectPicker.tsx', {
    ...pickerOverrides,
    '../offline/service': {createOfflineCollection: async (projectId, name) => {calls.push([projectId, name]); return {id: 'local:one', name, project_id: projectId};}},
  }).default;
  let chosen; let tree;
  await act(async () => {tree = create(React.createElement(Picker, {projects, sections: [], selectedId: 'p', onChange() {}, onSectionChange: id => {chosen = id;}}));});
  assert.deepEqual(calls, []);
  await act(async () => tree.root.findByProps({accessibilityLabel: 'New collection in House'}).props.onPress());
  await act(async () => tree.root.findByProps({accessibilityLabel: 'New collection name'}).props.onChangeText('Local'));
  await act(async () => tree.root.findByProps({accessibilityLabel: 'Save new collection'}).props.onPress());
  assert.deepEqual(calls, [['p', 'Local']]); assert.equal(chosen, 'local:one');
  await act(async () => tree.unmount());
});

test('collection creation reports failure and keeps the form open for correction', async () => {
  const Picker = load('../src/components/ProjectPicker.tsx', pickerOverrides).default;
  let tree;
  await act(async () => {tree = create(React.createElement(Picker, {projects, sections: [], selectedId: 'p', onChange() {}, onSectionChange() {},
    onCreateCollection: async () => {throw new Error('Collection could not be saved.');}}));});
  await act(async () => tree.root.findByProps({accessibilityLabel: 'New collection in House'}).props.onPress());
  await act(async () => tree.root.findByProps({accessibilityLabel: 'New collection name'}).props.onChangeText('Garden'));
  await act(async () => tree.root.findByProps({accessibilityLabel: 'Save new collection'}).props.onPress());
  assert.equal(tree.root.findAllByProps({accessibilityRole: 'alert'}).some(n => n.children.includes('Collection could not be saved.')), true);
  assert.equal(tree.root.findAllByProps({accessibilityLabel: 'New collection name'}).length, 1);
  await act(async () => tree.unmount());
});

test('AI settings fields keep API key input masked and delegate save ownership', async () => {
  const Fields = load('../src/components/AISettingsFields.tsx', {'react-native': nativeMocks()}).default;
  let saved = 0; let tree;
  await act(async () => {tree = create(React.createElement(Fields, {apiKey: 'secret-value', model: 'gpt-4.1-mini', onApiKeyChange() {}, onModelChange() {}, onSave: () => {saved++;}}));});
  const key = tree.root.findByProps({accessibilityLabel: 'OpenAI API key'});
  assert.equal(key.props.secureTextEntry, true);
  await act(async () => tree.root.findByProps({accessibilityLabel: 'Save AI settings'}).props.onPress());
  assert.equal(saved, 1);
  await act(async () => tree.unmount());
});
