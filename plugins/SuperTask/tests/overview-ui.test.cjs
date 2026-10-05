const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const {act, create} = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
function component() {
  const filename = path.resolve(__dirname, '../src/components/ProjectOverview.tsx');
  const mod = new Module(filename, module);
  mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const normal = mod.require.bind(mod);
  const native = {View: 'View', Text: 'Text', Pressable: 'Pressable', StyleSheet: {create: value => value},
    FlatList: ({data, renderItem}) => React.createElement('List', {}, data.map(item => React.createElement('Row', {key: item.key}, renderItem({item}))))};
  const overrides = {'react-native': native, '../utils/useFontScale': {useFontScale: () => 1},
    './TaskRow': {__esModule: true, default: props => React.createElement('Task', props)}};
  mod.require = name => Object.hasOwn(overrides, name) ? overrides[name] : normal(name);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true},
  }).outputText, filename);
  return mod.exports.default;
}
const projects = [{id: 'a', name: 'Home'}, {id: 'b', name: 'Work'}];
const tasks = [{id: 'one', project_id: 'a', content: 'First'}, {id: 'two', project_id: 'b', content: 'Second'}];
const byText = (root, text) => root.findAllByType('Pressable').find(node => node.findAllByType('Text').some(label => label.props.children === text));
test('inline expansion is independent; task/project actions and density remain reachable', async () => {
  const Overview = component(); let tree; const opened = [];
  await act(async () => {tree = create(React.createElement(Overview, {projects, tasks, selectedIds: [], onSelect() {},
    onTask: task => opened.push(task.id), onProject: project => opened.push(project.id)}));});
  assert.equal(tree.root.findAllByType('Task').length, 0);
  await act(async () => {tree.root.findByProps({accessibilityLabel: 'Expand Home'}).props.onPress();});
  await act(async () => {tree.root.findByProps({accessibilityLabel: 'Expand Work'}).props.onPress();});
  assert.equal(tree.root.findAllByType('Task').length, 2);
  assert.equal(tree.root.findAllByType('Task')[0].props.compact, true);
  tree.root.findAllByType('Task')[0].props.onPress(tasks[0]);
  tree.root.findByProps({accessibilityLabel: 'Open Work project view'}).props.onPress();
  assert.deepEqual(opened, ['one', 'b']);
  await act(async () => {byText(tree.root, 'Compact').props.onPress();});
  assert.equal(tree.root.findAllByType('Task')[0].props.compact, false);
  await act(async () => {tree.root.findByProps({accessibilityLabel: 'Collapse Home'}).props.onPress();});
  assert.deepEqual(tree.root.findAllByType('Task').map(node => node.props.task.id), ['two']);
  await act(async () => {tree.unmount();});
});
test('Expand all shows every project; Collapse all removes concealed selections', async () => {
  const Overview = component(); let tree; const deselected = [];
  await act(async () => {tree = create(React.createElement(Overview, {projects, tasks, selectedIds: ['one'],
    onSelect: () => assert.fail('Collapsing must not invoke completion'), onDeselect: ids => deselected.push(...ids), onTask() {}, onProject() {}}));});
  await act(async () => {byText(tree.root, 'Expand all').props.onPress();});
  assert.equal(tree.root.findAllByType('Task').length, 2);
  await act(async () => {byText(tree.root, 'Collapse all').props.onPress();});
  assert.deepEqual(deselected, ['one']);
  assert.equal(tree.root.findAllByType('Task').length, 0);
  await act(async () => {tree.unmount();});
});
