const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const {act, create} = require('react-test-renderer');
const keyboardAvoidance = require('./keyboard-avoidance-mock.cjs');

global.IS_REACT_ACT_ENVIRONMENT = true;

function loadTaskDetail(updateTask) {
  const filename = path.resolve(__dirname, '../src/screens/TaskDetail.tsx');
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const normal = mod.require.bind(mod);
  const mocks = {
    '../components/KeyboardAvoidance': keyboardAvoidance,
    'react-native': {View: 'View', Text: 'Text', TextInput: 'Input', Pressable: 'Pressable', ScrollView: 'ScrollView', StyleSheet: {create: value => value}},
    'sn-plugin-lib': {PluginCommAPI: {}},
    '../utils/closePlugin': {closePlugin() {}}, '../utils/config': {loadConfig: async () => ({})},
    '../utils/noteOpener': {openNote: async () => {}}, '../utils/noteLabel': {noteLabel: () => ''},
    '../api/todoist': {setConfigLoader() {}, updateTask, completeTask: async () => {}, deleteTask: async () => {}},
    '../cache/taskCache': {invalidateCache() {}}, '../utils/debug': {log() {}, logError() {}},
    '../components/PriorityPicker': {__esModule: true, default: () => null},
    '../components/ProjectPicker': {__esModule: true, default: () => null},
    '../collections/useLocations': {useLocations: projects => ({projects, sections: []})},
    '../components/DatePicker': {__esModule: true, default: () => null},
    '../utils/useFontScale': {useFontScale: () => 1}, '../offline/service': {retryOffline: async () => {}},
  };
  mod.require = name => Object.hasOwn(mocks, name) ? mocks[name] : normal(name);
  const source = fs.readFileSync(filename, 'utf8');
  mod._compile(ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.React, esModuleInterop: true}}).outputText, filename);
  return mod.exports.default;
}

for (const due of [
  {date: '2026-10-18T09:30:00', string: '2026-10-18 09:30', is_recurring: false},
  {date: '2026-10-19', string: 'every Monday', is_recurring: true},
]) {
  test(`editing description preserves unchanged due object (${due.string})`, async () => {
    let changes;
    const Screen = loadTaskDetail(async (_id, value) => {changes = value; return null;});
    const task = {id: 'task-1', content: 'Call vet', description: 'Old notes', priority: 1, labels: [], due, project_id: null, section_id: null};
    let tree;
    await act(async () => {tree = create(React.createElement(Screen, {nav: {canGoBack: false, pop() {}, resetTo() {}}, task, projects: []}));});
    const description = tree.root.findAllByType('Input')[1];
    await act(async () => description.props.onChangeText('New notes'));
    const save = tree.root.findAllByType('Pressable').find(node => node.findAllByType('Text').some(text => text.props.children === 'Save Changes'));
    assert.ok(save);
    await act(async () => save.props.onPress());
    assert.equal(changes.description, 'New notes');
    assert.equal(Object.hasOwn(changes, 'dueString'), false);
    await act(async () => tree.unmount());
  });
}
