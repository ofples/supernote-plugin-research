const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const {act, create} = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
function load(file, overrides) {
  const filename = path.resolve(__dirname, file);
  const mod = new Module(filename, module);
  mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const normal = mod.require.bind(mod);
  mod.require = name => Object.hasOwn(overrides, name) ? overrides[name] : normal(name);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true},
  }).outputText, filename);
  return mod.exports;
}
const projects = [{id: 'i', name: 'Inbox', inbox_project: true}, {id: 'p', name: 'House'}, {id: 'q', name: 'Work'}];
const sections = [{id: 'is', project_id: 'i', name: 'Later'}, {id: 'ps', project_id: 'p', name: 'Garden'}, {id: 'qs', project_id: 'q', name: 'Office'}];
test('picker reveals only selected project collections, resolves implicit Inbox and clears cross-project selection', async () => {
  const Picker = load('../src/components/ProjectPicker.tsx', {
    'react-native': {View: 'View', Text: 'Text', Pressable: 'Pressable', StyleSheet: {create: value => value}},
    '../utils/useFontScale': {useFontScale: () => 1},
  }).default;
  let current; let tree;
  function Form() {
    const [project, setProject] = React.useState(null);
    const [section, setSection] = React.useState(null);
    current = {project, section};
    return React.createElement(Picker, {projects, sections, selectedId: project, selectedSectionId: section,
      onChange: id => {if (id !== project) setSection(null); setProject(id);}, onSectionChange: setSection});
  }
  await act(async () => {tree = create(React.createElement(Form));});
  const choices = () => tree.root.findAllByType('Pressable').map(n => n.props.accessibilityLabel).filter(s => s.startsWith('Choose collection'));
  assert.deepEqual(choices(), ['Choose collection No collection', 'Choose collection Later']);
  await act(async () => tree.root.findByProps({accessibilityLabel: 'Choose collection Later'}).props.onPress());
  assert.deepEqual(current, {project: 'i', section: 'is'});
  await act(async () => tree.root.findByProps({accessibilityLabel: 'Choose project House'}).props.onPress());
  assert.deepEqual(current, {project: 'p', section: null});
  assert.deepEqual(choices(), ['Choose collection No collection', 'Choose collection Garden']);
  await act(async () => tree.root.findByProps({accessibilityLabel: 'Choose collection Garden'}).props.onPress());
  assert.deepEqual(current, {project: 'p', section: 'ps'});
  await act(async () => tree.unmount());
});
function api(task) {
  const remembered = []; const edited = [];
  const client = load('../src/api/todoist.js', {
    '../utils/permissions': {ensurePermissionGroup: async () => true}, '../utils/debug': {log() {}},
    '../offline/service': {cachedTask: async () => task, offlineData: async () => ({projects, sections}),
      rememberRemoteTask: async value => remembered.push(value), syncOffline: async () => {},
      editOfflineTask: async (...args) => edited.push(args)},
  });
  client.setConfigLoader(async () => ({apiToken: 'test-only-token'}));
  return {client, remembered, edited};
}
test('online collection changes use the move endpoint; unrelated updates preserve collection', async () => {
  const oldFetch = global.fetch; const requests = [];
  const task = {id: 'remote-id', content: 'Test', project_id: 'p', section_id: 'ps', syncState: 'synced'};
  const {client, remembered} = api(task);
  global.fetch = async (url, options) => {
    requests.push({url, body: JSON.parse(options.body)});
    return {ok: true, status: 200, json: async () => ({...task, section_id: url.endsWith('/move') ? null : 'ps'})};
  };
  try {
    await client.updateTask(task.id, {content: 'Changed'});
    assert.equal(requests.length, 1); assert.deepEqual(requests[0].body, {content: 'Changed'});
    await client.updateTask(task.id, {sectionId: null});
    assert.equal(requests[1].url, 'https://api.todoist.com/api/v1/tasks/remote-id/move');
    assert.deepEqual(requests[1].body, {project_id: 'p'});
    assert.equal(remembered.at(-1).section_id, null);
  } finally {global.fetch = oldFetch;}
});
test('unsent task editing preserves collection offline and never calls the network', async () => {
  const oldFetch = global.fetch; global.fetch = () => {throw new Error('Unexpected request');};
  const task = {id: 'local:task', content: 'Test', project_id: 'p', section_id: 'ps'};
  const {client, edited} = api(task);
  try {
    await client.updateTask(task.id, {content: 'Changed'});
    assert.equal(edited[0][1].sectionId, 'ps');
    await client.updateTask(task.id, {projectId: 'q'});
    assert.equal(edited[1][1].sectionId, null);
  } finally {global.fetch = oldFetch;}
});

test('batch Add row uses the configured collection; changing its project clears the old section before saving', async () => {
  const saved = [];
  const Batch = load('../src/screens/BatchAdd.tsx', {
    'react-native': {View: 'View', Text: 'Text', TextInput: 'Input', Pressable: 'Pressable', ScrollView: 'ScrollView', StyleSheet: {create: value => value}},
    'sn-plugin-lib': {PluginManager: {registerPluginLifeListener: () => ({remove() {}})}},
    '../utils/closePlugin': {closePlugin() {}},
    '../offline/service': {saveOfflineBatch: async rows => {saved.push(rows); return rows;}},
    '../batch/refine': {},
    '../collections/useLocations': {useLocations: () => ({projects, sections})},
    '../components/ProjectPicker': {__esModule: true, default: props => React.createElement('Picker', props)},
    '../components/PriorityPicker': {__esModule: true, default: () => null},
    '../components/DatePicker': {__esModule: true, default: () => null},
  }).default;
  const button = (tree, label) => tree.root.findAllByType('Pressable').find(node => node.findAllByType('Text').some(text => text.props.children === label));
  let tree;
  await act(async () => {tree = create(React.createElement(Batch, {nav: {}, projects, defaultProjectId: 'p', defaultSectionId: 'ps'}));});
  await act(async () => button(tree, 'Add row').props.onPress());
  await act(async () => button(tree, 'Details').props.onPress());
  assert.equal(tree.root.findByType('Picker').props.selectedSectionId, 'ps');
  await act(async () => tree.root.findByType('Picker').props.onChange('q'));
  assert.equal(tree.root.findByType('Picker').props.selectedSectionId, null);
  await act(async () => tree.root.findByType('Picker').props.onSectionChange('qs'));
  await act(async () => button(tree, 'Save 1 task').props.onPress());
  assert.equal(saved[0][0].projectId, 'q'); assert.equal(saved[0][0].sectionId, 'qs');
  await act(async () => tree.unmount());
});

test('a failed online move reports partial success instead of claiming the location was changed', async () => {
  const oldFetch = global.fetch;
  const task = {id: 'remote-id', content: 'Test', project_id: 'p', section_id: 'ps', syncState: 'synced'};
  const {client, remembered} = api(task);
  global.fetch = async url => url.endsWith('/move') ? {ok: false, status: 400, text: async () => 'Collection no longer available'} :
    {ok: true, status: 200, json: async () => ({...task, content: 'Changed'})};
  try {
    await assert.rejects(client.updateTask(task.id, {content: 'Changed', sectionId: null}), /details were saved.*location could not be confirmed/);
    assert.equal(remembered[0].content, 'Changed'); assert.equal(remembered[0].section_id, 'ps');
  } finally {global.fetch = oldFetch;}
});

test('moving an acknowledged local task never stores its local ID as a remote task', async () => {
  const oldFetch = global.fetch;
  const task = {id: 'local:created', remoteId: 'real-id', content: 'Test', project_id: 'p', section_id: 'ps', syncState: 'synced'};
  const {client, remembered} = api(task);
  global.fetch = async url => {
    assert.equal(url, 'https://api.todoist.com/api/v1/tasks/real-id/move');
    return {ok: true, status: 200, json: async () => ({...task, id: 'real-id', section_id: null})};
  };
  try {
    await client.updateTask(task.id, {sectionId: null});
    assert.deepEqual(remembered.map(t => t.id), ['real-id']);
  } finally {global.fetch = oldFetch;}
});
