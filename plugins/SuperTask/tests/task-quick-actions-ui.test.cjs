const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const {act, create} = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
const native = {View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', StyleSheet: {create: value => value}};
function load(file, overrides = {}) {
  const filename = path.resolve(__dirname, file); const mod = new Module(filename, module);
  mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const normal = mod.require.bind(mod); mod.require = name => Object.hasOwn(overrides, name) ? overrides[name] : normal(name);
  mod._compile(ts.transpileModule(require('node:fs').readFileSync(filename, 'utf8'), {compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true,
  }}).outputText, filename); return mod.exports.default;
}
const actionsProps = calls => ({onEdit: () => calls.push('edit'), onDate: () => calls.push('date'), onMove: () => calls.push('move'),
  onPriority: () => calls.push('priority'), onMoveUp: () => calls.push('up'), onMoveDown: () => calls.push('down'), onDelete: () => calls.push('delete'), onDismiss: () => calls.push('dismiss')});
test('quick actions are icon-only accessible targets and keep their callbacks', async () => {
  const Actions = load('../src/components/TaskQuickActions.tsx', {'react-native': native, '../utils/useFontScale': {useFontScale: () => 1}});
  const calls = []; let tree;
  await act(async () => {tree = create(React.createElement(Actions, actionsProps(calls)));});
  const buttons = tree.root.findAllByType('Pressable');
  assert.equal(buttons.length, 8);
  assert.deepEqual(buttons.map(button => button.props.accessibilityLabel), ['Edit task', 'Set date', 'Move task', 'Set priority', 'Move task up', 'Move task down', 'Delete task', 'Close task actions']);
  for (const button of buttons.slice(0, 7)) {
    assert.equal(button.props.style[0].width, 44); assert.equal(button.props.style[0].height, 44);
    assert.equal(button.findAllByType('Text').length, 1);
    assert.equal(button.props.style[0].borderWidth, 1);
  }
  await act(async () => buttons[6].props.onPress());
  assert.deepEqual(calls, ['delete']);
  await act(async () => buttons[7].props.onPress());
  assert.deepEqual(calls, ['delete', 'dismiss']);
  await act(async () => tree.update(React.createElement(Actions, {...actionsProps(calls), maxWidth: 250})));
  assert.equal(tree.root.findAllByType('Pressable').some(button => button.props.accessibilityLabel === 'Move task up'), true);
  assert.equal(tree.root.findAllByType('Pressable').some(button => button.props.accessibilityLabel === 'Move task down'), true);
  assert.equal(tree.root.findByType('ScrollView').props.style[1].width, 250);
  await act(async () => tree.update(React.createElement(Actions, {...actionsProps(calls), maxWidth: 500})));
  assert.equal(tree.root.findByType('ScrollView').props.style[1].width, 341);
  assert.equal(tree.root.findByProps({accessibilityLabel: 'Set date'}).props.accessibilityState.disabled, false);
  await act(async () => tree.unmount());
});
test('project sidebar stays plain and never renders the legacy project options menu', async () => {
  const Sidebar = load('../src/components/NativeTaskSidebar.tsx', {'react-native': native, '../utils/useFontScale': {useFontScale: () => 1}});
  const changed = []; const legacyMenu = [];
  let tree; await act(async () => {tree = create(React.createElement(Sidebar, {activeView: 'project:p', projects: [{id: 'p', name: 'Work'}],
    noteAvailable: false, onViewChange: id => changed.push(id), onProjectMenu: id => legacyMenu.push(id)}));});
  assert.equal(tree.root.findAllByProps({accessibilityLabel: 'Options for Work'}).length, 0);
  await act(async () => tree.root.findByProps({accessibilityLabel: 'Work'}).props.onPress());
  assert.deepEqual(changed, ['project:p']); assert.deepEqual(legacyMenu, []);
  await act(async () => tree.unmount());
});
test('native sidebar uses one solid separator above Projects', async () => {
  const Sidebar = load('../src/components/NativeTaskSidebar.tsx', {'react-native': native, '../utils/useFontScale': {useFontScale: () => 1}});
  let tree;
  await act(async () => {tree = create(React.createElement(Sidebar, {activeView: 'projects', projects: [], noteAvailable: false, onViewChange: () => {}}));});
  const header = tree.root.findByProps({accessibilityRole: 'header'});
  assert.equal(header.props.style.borderTopWidth, 2);
  assert.equal(header.props.style.borderTopColor, '#000000');
  assert.equal(header.props.style.borderStyle, 'solid');
  assert.equal(header.props.style.borderBottomWidth, undefined);
  await act(async () => tree.unmount());
});
