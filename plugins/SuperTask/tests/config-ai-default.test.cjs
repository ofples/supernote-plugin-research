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

test('AI by default reverts to saved value after a failed write and can be retried', async () => {
  const config = {aiByDefault: false, aiModels: ['gpt-4.1-mini'], aiModel: 'gpt-4.1-mini'};
  let rejectWrites = true;
  const configAPI = {getCachedConfig: () => config, getConfigSource: () => 'device', wasTemplateGenerated: () => false,
    loadConfig: async () => config, saveConfig: async patch => {
      if (rejectWrites) return false;
      Object.assign(config, patch);
      return true;
    }};
  const native = {View: 'View', Text: 'Text', TextInput: 'TextInput', Pressable: 'Pressable', ScrollView: 'ScrollView', Clipboard: {}, StyleSheet: {create: value => value}};
  const section = props => React.createElement('Section', null, props.children);
  const checkRow = props => React.createElement('Pressable', {accessibilityLabel: props.label, accessibilityState: {checked: props.checked}, onPress: props.onToggle},
    React.createElement('Text', null, props.label));
  const settings = {Section: section, SettingRow: () => null, Segmented: () => null, CheckRow: checkRow,
    CheckItem: () => null, InfoSheet: () => null, InputSheet: () => null};
  const filename = path.resolve(__dirname, '../src/screens/Config.tsx'), mod = new Module(filename, module);
  mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const normal = mod.require.bind(mod);
  mod.require = name => {
    if (name === 'react-native') return native;
    if (name === '../components/KeyboardAvoidance') return keyboardAvoidance;
    if (name === '../utils/config') return configAPI;
    if (name === '../utils/permissions') return {PERMISSION_GROUPS: [], getPermissionStates: async () => ({supported: false, groups: {}}), ensurePermissionGroup: async () => true};
    if (name === '../utils/closePlugin') return {closePlugin() {}};
    if (name === '../api/todoist') return {setConfigLoader() {}, testConnection: async () => ({}), getProjects: async () => []};
    if (name === '../utils/debug') return {log() {}, setDebugMode() {}, getEntries: () => [], exportLog: async () => ''};
    if (name === '../utils/gestureDetector') return {reloadGestureConfig() {}};
    if (name === '../utils/tokenImport') return {importTokenFromFile: async () => '', findTokenFile: async () => null, TOKEN_DIR_LABEL: ''};
    if (name === '../components/ProjectPicker' || name === '../components/AISettingsFields' || name === '../launcher/LauncherSettings') return () => null;
    if (name === '../components/settings') return settings;
    if (name === '../collections/useLocations') return {useLocations: () => ({projects: [], sections: []})};
    if (name === '../utils/fontScale') return {FONT_SCALE_STEPS: [1], normalizeFontScale: value => value};
    if (name === '../utils/aiModels') return {normalizeAIModels: (models, current) => models || [current]};
    if (name === '../utils/projectVisibility') return {isProjectVisible: () => true, toggleProjectVisibility: () => []};
    return normal(name);
  };
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true,
  }}).outputText, filename);
  let tree;
  await act(async () => {tree = create(React.createElement(mod.exports.default, {initialPage: 'setup', onNavigate() {}}));});
  const toggle = () => tree.root.findByProps({accessibilityLabel: 'AI by default'});
  assert.equal(toggle().props.accessibilityState.checked, false);
  await act(async () => toggle().props.onPress());
  assert.equal(config.aiByDefault, false);
  assert.equal(toggle().props.accessibilityState.checked, false);

  rejectWrites = false;
  await act(async () => toggle().props.onPress());
  assert.equal(config.aiByDefault, true);
  assert.equal(toggle().props.accessibilityState.checked, true);
  await act(async () => tree.unmount());
});
