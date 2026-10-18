const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const {act, create} = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;

const native = {View: 'View', Text: 'Text', Pressable: 'Pressable', StyleSheet: {create: value => value}};
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

test('workspace header and view controls use bordered text while sidebar remains an accessible icon', async () => {
  const {HeaderActionButtons, WorkspaceViewControls, WorkspaceSidebarToggle} = load('../src/components/WorkspaceActionButtons.tsx');
  const calls = [];
  let header; let controls; let sidebar;
  await act(async () => {header = create(React.createElement(HeaderActionButtons, {
    onSettings: () => calls.push('settings'), onClose: () => calls.push('close'),
  }));});
  await act(async () => {controls = create(React.createElement(WorkspaceViewControls, {
    onViewOptions: () => calls.push('view'), onListMenu: () => calls.push('menu'), viewOptionsOpen: true,
  }));});
  await act(async () => {sidebar = create(React.createElement(WorkspaceSidebarToggle, {collapsed: true, onPress: () => calls.push('sidebar')}));});

  for (const tree of [header, controls]) {
    const group = tree.root.findByType('View');
    assert.equal(group.props.style.justifyContent, 'flex-end');
    const buttons = tree.root.findAllByType('Pressable');
    assert.equal(buttons.length, 2);
    for (const button of buttons) {
      const styles = button.props.style({pressed: false});
      const style = Object.assign({}, ...styles.filter(value => typeof value === 'object'));
      assert.equal(button.props.accessibilityRole, 'button');
      assert.equal(style.minWidth, 44); assert.equal(style.minHeight, 44);
      assert.equal(style.borderWidth, 1);
      assert.equal(button.findAllByType('Text').length, 1, 'each restored control has a visible text label');
    }
  }
  assert.deepEqual(header.root.findAllByType('Pressable').map(button => button.props.accessibilityLabel), ['Settings', 'Close']);
  assert.deepEqual(controls.root.findAllByType('Pressable').map(button => button.props.accessibilityLabel), ['Workspace view options', 'List menu']);
  assert.deepEqual(header.root.findAllByType('Text').map(text => text.props.children), ['Settings', 'Close']);
  assert.deepEqual(controls.root.findAllByType('Text').map(text => text.props.children), ['View', '…']);
  assert.equal(controls.root.findAllByType('Pressable')[0].props.accessibilityState.expanded, true);
  const sidebarButton = sidebar.root.findByType('Pressable');
  assert.equal(sidebarButton.props.accessibilityLabel, 'Show sidebar');
  assert.equal(sidebarButton.findAllByType('Text').length, 0, 'sidebar keeps the existing icon affordance');
  for (const button of [...header.root.findAllByType('Pressable'), ...controls.root.findAllByType('Pressable'), sidebarButton]) {
    await act(async () => button.props.onPress());
  }
  assert.deepEqual(calls, ['settings', 'close', 'view', 'menu', 'sidebar']);
  await act(async () => {header.unmount(); controls.unmount(); sidebar.unmount();});
});

test('workspace header uses symmetric padding without a reserved Home-control gutter', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/screens/TaskHome.tsx'), 'utf8');
  assert.match(source, /header:\s*\{[^}]*padding:\s*16,/s);
  assert.doesNotMatch(source, /paddingRight:\s*(?:selectionMode|56|60)/);
  assert.doesNotMatch(source, /host Home control/);
  assert.match(source, /height: Math\.max\(76, Math\.round\(22 \* scale \* 1\.3\) \+ 32\)/);
  const component = fs.readFileSync(path.resolve(__dirname, '../src/components/WorkspaceActionButtons.tsx'), 'utf8');
  assert.match(component, /marginLeft: 'auto', flexShrink: 0/);
});
