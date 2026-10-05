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
      editOfflineTask: async (...args) => {edited.push(args); return {...task, ...args[1]};},
      completedData: async () => remembered, rememberCompleted: async values => remembered.push(...values),
      completeOffline: async () => {throw Object.assign(new Error('Cannot undo a sent recurring occurrence'), {code: 'RECURRING_UNDO_UNSUPPORTED'});}},
  });
  client.setConfigLoader(async () => ({apiToken: 'test-only-token'}));
  return {client, remembered, edited};
}
test('cached existing task edits and moves queue locally without depending on reachability', async () => {
  const oldFetch = global.fetch; global.fetch = () => {throw new Error('Unexpected request');};
  const task = {id: 'remote-id', content: 'Test', project_id: 'p', section_id: 'ps', syncState: 'synced'};
  const {client, edited, remembered} = api(task);
  try {
    await client.updateTask(task.id, {content: 'Changed'});
    assert.deepEqual(edited[0], [task.id, {content: 'Changed'}]);
    await client.updateTask(task.id, {sectionId: null});
    assert.deepEqual(edited[1], [task.id, {project_id: 'p', section_id: null}]);
    assert.equal(remembered.length, 0);
  } finally {global.fetch = oldFetch;}
});
test('rejected recurring undo never premarks a legacy raw-ID next occurrence completed', async () => {
  const task = {id: 'raw-id', remoteId: 'raw-id', content: 'Legacy recurring task', completed: false, due: {is_recurring: true}};
  const {client, remembered} = api(task);
  await assert.rejects(client.reopenTask(task.id), error => error.code === 'RECURRING_UNDO_UNSUPPORTED');
  assert.equal(remembered.length, 0); assert.equal(task.completed, false);
});

test('local task editing preserves omitted collection and clears it across projects', async () => {
  const oldFetch = global.fetch; global.fetch = () => {throw new Error('Unexpected request');};
  const task = {id: 'local:task', content: 'Test', project_id: 'p', section_id: 'ps'};
  const {client, edited} = api(task);
  try {
    await client.updateTask(task.id, {content: 'Changed'});
    assert.equal(Object.hasOwn(edited[0][1], 'section_id'), false);
    await client.updateTask(task.id, {projectId: 'q'});
    assert.deepEqual(edited[1][1], {project_id: 'q', section_id: null});
  } finally {global.fetch = oldFetch;}
});

test('batch Add row uses the configured collection; changing its project clears the old section before saving', async () => {
  const saved = [];
  const Batch = load('../src/screens/BatchAdd.tsx', {
    '../utils/useFontScale': {useFontScale: () => 1},
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

test('acknowledged local task keeps its stable local identity when queuing a move', async () => {
  const oldFetch = global.fetch; global.fetch = () => {throw new Error('Unexpected request');};
  const task = {id: 'local:created', remoteId: 'real-id', content: 'Test', project_id: 'p', section_id: 'ps', syncState: 'synced'};
  const {client, edited, remembered} = api(task);
  try {
    await client.updateTask(task.id, {sectionId: null});
    assert.equal(edited[0][0], 'local:created'); assert.equal(remembered.length, 0);
  } finally {global.fetch = oldFetch;}
});


test('history accepts numeric successful HTTP status and bounds older requests', async () => {
  const oldFetch = global.fetch; const urls = [];
  global.fetch = async url => {urls.push(new URL(url)); return {status: 200, json: async () => ({items: [{id: String(urls.length)}]})};};
  try {
    const {client, remembered} = api(null);
    await client.refreshCompletedTasks(120);
    assert.equal(urls.length, 2);
    assert.equal(remembered.length, 2);
    for (const url of urls) assert.ok(new Date(url.searchParams.get('until')) - new Date(url.searchParams.get('since')) <= 89 * 86400000);
    global.fetch = async () => ({status: 401, json: async () => ({})});
    await assert.rejects(client.refreshCompletedTasks(), /HTTP 401/);
    assert.equal(remembered.length, 2, 'failed refresh preserves cached history');
  } finally {global.fetch = oldFetch;}
});
