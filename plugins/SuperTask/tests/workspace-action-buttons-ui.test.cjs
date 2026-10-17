const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const {act, create} = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;

const native = {View: 'View', Pressable: 'Pressable', StyleSheet: {create: value => value}};
function load(file) {
  const filename = path.resolve(__dirname, file); const mod = new Module(filename, module);
  mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const normal = mod.require.bind(mod);
  mod.require = name => name === 'react-native' ? native : normal(name);
  mod._compile(ts.transpileModule(require('node:fs').readFileSync(filename, 'utf8'), {compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true,
  }}).outputText, filename);
  return mod.exports;
}

test('header and workspace controls are right-aligned, borderless icon buttons with accessible labels', async () => {
  const {HeaderActionButtons, WorkspaceViewControls} = load('../src/components/WorkspaceActionButtons.tsx');
  const calls = [];
  let header; let controls;
  await act(async () => {header = create(React.createElement(HeaderActionButtons, {
    onSettings: () => calls.push('settings'), onClose: () => calls.push('close'),
  }));});
  await act(async () => {controls = create(React.createElement(WorkspaceViewControls, {
    onViewOptions: () => calls.push('view'), onListMenu: () => calls.push('menu'), viewOptionsOpen: true,
  }));});

  for (const tree of [header, controls]) {
    const group = tree.root.findByType('View');
    assert.equal(group.props.style.justifyContent, 'flex-end');
    const buttons = tree.root.findAllByType('Pressable');
    assert.equal(buttons.length, 2);
    for (const button of buttons) {
      const styles = button.props.style({pressed: false});
      const style = Object.assign({}, ...styles.filter(value => typeof value === 'object'));
      assert.equal(button.props.accessibilityRole, 'button');
      assert.equal(style.width, 44); assert.equal(style.height, 44);
      assert.equal(style.borderWidth, undefined);
      assert.equal(button.findAllByType('View').length > 0, true, 'each control renders a native icon');
    }
  }
  assert.deepEqual(header.root.findAllByType('Pressable').map(button => button.props.accessibilityLabel), ['Settings', 'Close']);
  assert.deepEqual(controls.root.findAllByType('Pressable').map(button => button.props.accessibilityLabel), ['Workspace view options', 'List menu']);
  assert.equal(controls.root.findByProps({accessibilityLabel: 'Workspace view options'}).props.accessibilityState.expanded, true);
  for (const button of [...header.root.findAllByType('Pressable'), ...controls.root.findAllByType('Pressable')]) {
    await act(async () => button.props.onPress());
  }
  assert.deepEqual(calls, ['settings', 'close', 'view', 'menu']);
  await act(async () => {header.unmount(); controls.unmount();});
});
