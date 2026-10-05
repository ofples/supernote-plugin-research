const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const {create, act} = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;

function settings() {
  const filename = path.resolve(__dirname, '../src/launcher/LauncherSettings.tsx');
  const loaded = new Module(filename, module);
  loaded.filename = filename; loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  let finish, patch;
  const config = {launcherEnabled: false, launcherEdge: 'right'};
  const mocks = {
    'react-native': {View: 'View', Text: 'Text', Pressable: 'Pressable', StyleSheet: {create: x => x}, AppState: {addEventListener: () => ({remove() {}})}},
    '../components/settings': {CheckRow: 'CheckRow', Section: 'Section', Segmented: 'Segmented', SettingRow: 'SettingRow'},
    '../utils/config': {
      loadConfig: async () => ({...config}), getCachedConfig: () => ({...config}),
      saveConfig: value => {patch = value; return new Promise(resolve => {finish = success => {if (success) Object.assign(config, value); resolve(success);};});},
    },
    './service': {launcherStatus: async () => ({permission: true, available: true, foregroundDetection: true}), reloadLauncher: async () => {}, confirmLauncherPreference: async () => {}},
  };
  const normal = loaded.require.bind(loaded);
  loaded.require = name => Object.hasOwn(mocks, name) ? mocks[name] : normal(name);
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true,
  }}).outputText, filename);
  return {Screen: loaded.exports.default, finish: result => finish(result), patch: () => patch};
}

test('launcher toggle renders intent before local save resolves and rolls back a known failed commit', async () => {
  const f = settings(); let tree;
  await act(async () => {tree = create(React.createElement(f.Screen));});
  assert.equal(tree.root.findByType('CheckRow').props.checked, false);
  await act(async () => {tree.root.findByType('CheckRow').props.onToggle();});
  assert.equal(tree.root.findByType('CheckRow').props.checked, true);
  assert.deepEqual(f.patch(), {launcherEnabled: true});
  await act(async () => f.finish(false));
  assert.equal(tree.root.findByType('CheckRow').props.checked, false);
  assert.ok(tree.root.findAllByType('Text').some(t => t.props.children === 'Settings could not be saved.'));
  await act(async () => tree.unmount());
});
test('edge selection renders immediately during durable write then stays after commit', async () => {
  const f = settings(); let tree;
  await act(async () => {tree = create(React.createElement(f.Screen));});
  await act(async () => {tree.root.findByType('Segmented').props.onChange('left');});
  assert.equal(tree.root.findByType('Segmented').props.value, 'left');
  await act(async () => f.finish(true));
  assert.equal(tree.root.findByType('Segmented').props.value, 'left');
  assert.ok(tree.root.findAllByType('Text').some(t => t.props.children === 'Saved on device'));
  await act(async () => tree.unmount());
});
