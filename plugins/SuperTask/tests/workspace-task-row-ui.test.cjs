const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const fs = require('node:fs');
const ts = require('typescript');
const React = require('react');
const {act, create} = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;

const native = {View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView',
  StyleSheet: {create: value => value}};
function load(file, overrides = {}) {
  const filename = path.resolve(__dirname, file); const mod = new Module(filename, module);
  mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const normal = mod.require.bind(mod);
  mod.require = name => Object.hasOwn(overrides, name) ? overrides[name] : name === 'react-native' ? native : name === '../utils/useFontScale' ? {useFontScale: () => 1}
    : name === '../utils/debug' ? {log: () => {}}
    : name === '../offline/model' ? {localDate: () => '2026-10-17'} : normal(name);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true,
  }}).outputText, filename);
  return mod.exports;
}

test('expansion reveals the user description, preserves editor action and draws the selection outline last', async () => {
  const taskRow = load('../src/components/TaskRow.tsx', {'./Chip': () => null, './settings': {Check: () => null}});
  const quickActions = load('../src/components/TaskQuickActions.tsx');
  const workspaceRow = load('../src/workspace/WorkspaceTaskRow.tsx', {'../components/TaskRow': taskRow,
    '../components/TaskQuickActions': quickActions});
  const {WorkspaceContext} = workspaceRow;
  const task = {id: 'remote:task-1', content: 'Prepare meeting', description: 'Bring printed agenda\n\n---\n[SuperTask] Captured from: /notes/meeting.note p.4',
    priority: 1, labels: [], due: null};
  const calls = [];
  const workspace = {identity: () => 'remote:task-1', selectedIds: [], selectionMode: false, expandedId: null,
    project: value => value, protectedHistory: () => false, canSelect: () => true, canOrder: () => true,
    expand: id => calls.push(['expand', id]), edit: value => calls.push(['edit', value.id]),
    action: (...args) => calls.push(['action', ...args]), order: (...args) => calls.push(['order', ...args]),
    complete: (...args) => calls.push(['complete', ...args]), toggle: id => calls.push(['toggle', id]),
    retryCreate: id => calls.push(['retry', id]), select: id => calls.push(['select', id])};
  const element = expanded => React.createElement(WorkspaceContext.Provider, {value: {...workspace, expandedId: expanded ? 'remote:task-1' : null}},
    React.createElement(workspaceRow.default, {task, onCheckPress: () => {}, onPress: () => {}}));
  let tree; await act(async () => {tree = create(element(false));});
  assert.equal(tree.root.findAllByProps({accessibilityLabel: 'Description: Bring printed agenda'}).length, 0);
  const row = tree.root.findAllByType('Pressable').find(node => node.findAllByType('Text').some(text => text.props.children === 'Prepare meeting'));
  await act(async () => row.props.onPress());
  assert.deepEqual(calls, [['expand', 'remote:task-1']]);
  await act(async () => tree.update(element(true)));
  assert.equal(tree.root.findByProps({accessibilityLabel: 'Description: Bring printed agenda'}).props.children, 'Bring printed agenda');
  assert.equal(tree.root.findAllByProps({accessibilityLabel: 'Description: Bring printed agenda'}).length, 1);
  const outline = tree.root.findAllByType('View').find(node => node.props.style?.zIndex === 3);
  assert.ok(outline, 'selected outline is rendered as a top layer');
  const outlineIndex = tree.root.findAllByType('View').indexOf(outline);
  const overlay = tree.root.findAllByType('View').find(node => node.props.style?.zIndex === 2);
  assert.ok(overlay);
  assert.equal(overlay.props.style.top, 14, 'accessory stays aligned with title instead of expanded description');
  assert.equal(overlay.props.style.right, 16, 'action strip is inset from the task border');
  assert.equal(overlay.props.style.bottom, undefined);
  assert.equal(overlay.props.style.justifyContent, undefined);
  assert.ok(outlineIndex > tree.root.findAllByType('View').indexOf(overlay));
  assert.equal(outline.props.style.right, 0);
  assert.equal(outline.props.style.zIndex, 3, 'selected outline stays above the action strip');
  assert.equal(overlay.props.style.backgroundColor, undefined);
  await act(async () => tree.root.findByProps({accessibilityLabel: 'Edit task'}).props.onPress());
  assert.deepEqual(calls.at(-1), ['edit', 'remote:task-1']);
  await act(async () => tree.unmount());
});
