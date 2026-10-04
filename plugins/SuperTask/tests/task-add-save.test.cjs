const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const {act, create} = require('react-test-renderer');

global.IS_REACT_ACT_ENVIRONMENT = true;

function loadTaskAdd(mocks) {
  const filename = path.resolve(__dirname, '../src/screens/TaskAdd.tsx');
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const normal = mod.require.bind(mod);
  mod.require = name => Object.hasOwn(mocks, name) ? mocks[name] : normal(name);
  const source = fs.readFileSync(filename, 'utf8');
  mod._compile(ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true},
  }).outputText, filename);
  return mod.exports.default;
}

function makeScreen({createTask, registryAddTask = async () => {}, projects = []}) {
  const nav = {pushCalls: [], popCalls: 0, replaceCalls: 0,
    push(...args) {this.pushCalls.push(args);}, pop() {this.popCalls += 1;}, replace() {this.replaceCalls += 1;}};
  const rn = {View: 'View', Text: 'Text', TextInput: 'Input', Pressable: 'Pressable', ScrollView: 'ScrollView', StyleSheet: {create: value => value}};
  const screen = loadTaskAdd({
    'react-native': rn,
    'sn-plugin-lib': {PluginNoteAPI: {setLassoStrokeLink: async () => ({}), saveCurrentNote: async () => ({})}, PluginCommAPI: {}},
    '../utils/closePlugin': {closePlugin() {}},
    '../utils/config': {loadConfig: async () => ({postCreateAction: 'prompt'})},
    '../api/todoist': {setConfigLoader() {}, createTask},
    '../cache/taskCache': {invalidateCache() {}},
    '../utils/debug': {log() {}, logError() {}},
    '../utils/taskRegistry': {addTask: registryAddTask},
    '../components/PriorityPicker': {__esModule: true, default: () => null},
    '../components/ProjectPicker': {__esModule: true, default: () => null},
    '../collections/useLocations': {useLocations: values => ({projects: values, sections: []})},
    '../components/DatePicker': {__esModule: true, default: () => null},
    '../utils/useFontScale': {useFontScale: () => 1},
    '../utils/rectUtils': {clampRectToPage: value => value},
  });
  return {screen, nav, projects};
}

function findButton(tree, label) {
  const button = tree.root.findAllByType('Pressable').find(node =>
    node.findAllByType('Text').some(text => text.props.children === label));
  assert.ok(button, `expected button "${label}"`);
  return button;
}

test('TaskAdd known validation failure leaves the title editable for correction', async () => {
  const {screen, nav, projects} = makeScreen({createTask: async () => {throw new Error('should not be called for an empty title');}});
  let tree;
  await act(async () => {tree = create(React.createElement(screen, {nav, projects, initialContent: '   '}));});
  await act(async () => findButton(tree, 'Save task').props.onPress());
  const title = tree.root.findAllByType('Input')[0];
  assert.equal(title.props.editable, true);
  assert.equal(title.props.value, '   ');
  assert.match(tree.root.findAllByType('Text').map(node => String(node.props.children)).join(' '), /Task title cannot be empty/);
  await act(async () => tree.unmount());
});

test('TaskAdd uncertain commit locks fields and retries with the same request object', async () => {
  const requests = [];
  const {screen, nav, projects} = makeScreen({createTask: async input => {
    requests.push(input.request);
    throw Object.assign(new Error('Storage readback failed'), {uncertainCommit: true});
  }});
  let tree;
  await act(async () => {tree = create(React.createElement(screen, {nav, projects, initialContent: 'Review report'}));});
  await act(async () => findButton(tree, 'Save task').props.onPress());
  assert.equal(tree.root.findAllByType('Input')[0].props.editable, false);
  assert.ok(tree.root.findAllByType('Pressable').some(node => node.findAllByType('Text').some(text => text.props.children === 'Retry same task')));
  await act(async () => findButton(tree, 'Retry same task').props.onPress());
  assert.equal(requests.length, 2);
  assert.equal(requests[1], requests[0]);
  await act(async () => tree.unmount());
});

test('TaskAdd confirms the committed task when optional registry writing fails and opens Details with push', async () => {
  const task = {id: 'local-task-1', content: 'Review report'};
  let registryCalled = false;
  const {screen, nav, projects} = makeScreen({
    createTask: async () => task,
    registryAddTask: async () => {registryCalled = true; throw new Error('registry unavailable');},
  });
  const noteContext = {filePath: '/notes/Meeting.note', pageNum: 2, bounds: {left: 20, top: 20, right: 120, bottom: 80}};
  let tree;
  await act(async () => {tree = create(React.createElement(screen, {nav, projects, captureMode: 'lasso', noteContext, initialContent: task.content}));});
  await act(async () => findButton(tree, 'Save task').props.onPress());
  const copy = tree.root.findAllByType('Text').map(node => String(node.props.children)).join(' ');
  assert.match(copy, /Saved on this device/);
  assert.equal(registryCalled, true);
  const openTask = findButton(tree, task.content);
  await act(async () => openTask.props.onPress());
  assert.deepEqual(nav.pushCalls, [['task-detail', {task, projects}]]);
  assert.equal(nav.replaceCalls, 0);
  assert.equal(nav.popCalls, 0);
  await act(async () => tree.unmount());
});
