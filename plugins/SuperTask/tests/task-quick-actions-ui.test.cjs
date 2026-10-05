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
  for (const [index, button] of buttons.entries()) {
    const buttonStyle = Object.assign({}, ...button.props.style.filter(style => typeof style === 'object'));
    assert.equal(buttonStyle.width, 44); assert.equal(buttonStyle.height, 44);
    assert.equal(button.findAllByType('Text').length, 0);
    assert.equal(button.findAllByType('View').length > 0, true);
    assert.equal(buttonStyle.borderLeftWidth, index === 0 ? 0 : 1);
  }
  const strip = tree.root.findByType('ScrollView');
  assert.equal(strip.props.style[0].borderWidth, 1);
  assert.equal(strip.props.style[0].borderColor, '#000000');
  assert.equal(strip.props.style[0].width, undefined);
  assert.equal(strip.props.contentContainerStyle.flexDirection, 'row');
  for (const button of buttons) await act(async () => button.props.onPress());
  assert.deepEqual(calls, ['edit', 'date', 'move', 'priority', 'up', 'down', 'delete', 'dismiss']);
  await act(async () => tree.update(React.createElement(Actions, {...actionsProps(calls), maxWidth: 250})));
  assert.equal(tree.root.findAllByType('Pressable').some(button => button.props.accessibilityLabel === 'Move task up'), true);
  assert.equal(tree.root.findAllByType('Pressable').some(button => button.props.accessibilityLabel === 'Move task down'), true);
  assert.equal(tree.root.findByType('ScrollView').props.style[1].width, 250);
  await act(async () => tree.update(React.createElement(Actions, {...actionsProps(calls), maxWidth: 500})));
  assert.equal(tree.root.findByType('ScrollView').props.style[1].width, 354);
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
test('native sidebar has only a dotted divider below Projects', async () => {
  const Sidebar = load('../src/components/NativeTaskSidebar.tsx', {'react-native': native, '../utils/useFontScale': {useFontScale: () => 1}});
  let tree;
  await act(async () => {tree = create(React.createElement(Sidebar, {activeView: 'projects', projects: [], noteAvailable: false, onViewChange: () => {}}));});
  const header = tree.root.findByProps({accessibilityRole: 'header'});
  assert.equal(header.props.style.borderTopWidth, undefined);
  assert.equal(header.props.style.borderBottomColor, '#999999');
  assert.equal(header.props.style.borderStyle, 'dotted');
  assert.equal(header.props.style.borderBottomWidth, 1);
  await act(async () => tree.unmount());
});
