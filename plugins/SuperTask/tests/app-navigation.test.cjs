// Real App push/pop/reset navigation with the actual task forms. Only platform,
// storage/API services and unrelated destination screens are mocked.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const {act, create} = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
const flush = async () => {for (let i = 0; i < 15; i++) await Promise.resolve();};
const projects = [{id: 'p', name: 'House'}];
function compiled(file, overrides) {
  const filename = path.resolve(__dirname, file), mod = new Module(filename, module);
  mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const normal = mod.require.bind(mod);
  mod.require = name => Object.hasOwn(overrides, name) ? overrides[name] : normal(name);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true},
  }).outputText, filename);
  return mod.exports;
}
const esm = component => ({__esModule: true, default: component});
const press = (label, onPress) => React.createElement('Pressable', {onPress}, React.createElement('Text', null, label));
function byLabel(tree, label) {
  return tree.root.findAllByType('Pressable').find(node => node.props.accessibilityLabel === label || node.findAllByType('Text').some(text => text.props.children === label));
}
async function fixture(initial = {}) {
  const calls = {batches: [], single: [], logs: [], captureMounts: 0, captureUnmounts: 0};
  let identity = 0;
  const config = {postCreateAction: 'prompt', aiApiKey: 'test-key', aiSetupHintDismissed: true, ...initial.config};
  const configReads = [];
  const configModule = {loadConfig: async () => configReads.length ? configReads.shift() : config,
    saveConfig: async value => Object.assign(config, value), getCachedConfig: () => config};
  const debug = {log: (...args) => calls.logs.push(args), logError: (...args) => calls.logs.push(args),
    getEntries: () => [], setListener() {}, exportLog: async () => 'Done', setDebugMode() {}};
  const native = {View: 'View', Text: 'Text', ScrollView: 'ScrollView', TextInput: 'Input', Pressable: 'Pressable', StyleSheet: {create: value => value}};
  const sdk = {PluginManager: {registerConfigButtonListener: () => ({remove() {}}),
    registerButtonListener: () => ({remove() {}}), registerPluginLifeListener: () => ({remove() {}})}, PluginNoteAPI: {}, PluginCommAPI: {}};
  const api = {setConfigLoader() {}, getTask: async () => ({id: 'r', content: 'PRIVATE_DEEP_LINK_TITLE'}), getProjects: async () => projects,
    createTask: async draft => {calls.single.push(draft); return {...draft, id: `local:${++identity}`, syncState: 'pending'};}};
  const formOverrides = {
    'react-native': native, 'sn-plugin-lib': sdk,
    '../utils/config': configModule, '../utils/closePlugin': {closePlugin() {}}, '../utils/debug': debug,
    '../utils/useFontScale': {useFontScale: () => 1}, '../collections/useLocations': {useLocations: () => ({projects, sections: []})},
    '../components/ProjectPicker': esm(() => null), '../components/PriorityPicker': esm(() => null), '../components/DatePicker': esm(() => null),
    '../api/todoist': api, '../cache/taskCache': {invalidateCache() {}}, '../utils/taskRegistry': {addTask: async () => {}},
    '../batch/refine': {refineBatch: async () => [], refinementError: () => 'No provider call'},
    '../offline/service': {saveOfflineBatch: async rows => {calls.batches.push(rows); return rows.map(row => ({...row, id: `local:${++identity}`, syncState: 'pending'}));}},
  };
  const Batch = compiled('../src/screens/BatchAdd.tsx', formOverrides).default;
  const Single = compiled('../src/screens/TaskAdd.tsx', formOverrides).default;
  const Home = ({nav}) => {
    const [draft, setDraft] = React.useState('Initial workspace draft');
    const [listPosition, setListPosition] = React.useState('List at top');
    return React.createElement('Home', {nav},
    React.createElement('Text', null, draft), React.createElement('Text', null, listPosition),
    press('Edit workspace draft', () => setDraft('Unsaved workspace draft')),
    press('Scroll workspace list', () => setListPosition('List scrolled')),
    press('Open workspace detail', () => nav.push('task-detail', {task: {id: 'workspace', content: 'Workspace task'}, projects})),
    press('Open workspace settings', () => nav.push('ai-settings')),
    press('Start batch', () => nav.push('task-batch', {projects, initialContent: 'Task one\nTask two'})),
    press('Start single', () => nav.push('task-add', {projects, initialContent: 'Single title'})),
    press('Start capture', () => nav.push('capture-lasso')));
  };
  const Detail = ({nav, task}) => React.createElement('Detail', {nav, task}, press('Detail Back', nav.pop));
  const Settings = ({nav}) => React.createElement('Settings', {nav}, press('Settings Back', nav.pop),
    press('Save AI key', () => configModule.saveConfig({aiApiKey: 'updated-test-key'})));
  const Capture = ({nav}) => {
    React.useEffect(() => {calls.captureMounts++; return () => {calls.captureUnmounts++;};}, []);
    return React.createElement('Capture', {nav}, press('Capture settings', () => nav.push('ai-settings')));
  };
  const App = compiled('../App.tsx', {
    'react-native': native, 'sn-plugin-lib': sdk, './src/screens/TaskHome': esm(Home), './src/screens/TaskDetail': esm(Detail),
    './src/screens/TaskAdd': esm(Single), './src/screens/BatchAdd': esm(Batch), './src/screens/Capture': esm(Capture),
    './src/screens/AISettings': esm(Settings), './src/screens/ProjectView': esm(() => null), './src/screens/Config': esm(() => null), './src/screens/Diagnostics': esm(() => null),
    './src/utils/debug': debug, './src/utils/config': configModule, './src/utils/closePlugin': {closePlugin() {}},
    './src/utils/gestureDetector': {initGestureDetector() {}, clearLinkCache() {}},
    './src/utils/viewState': {markViewOpen() {}, markViewClosed() {}, setCurrentScreen() {}},
    './src/utils/taskRegistry': {getTask: async () => null}, './src/api/todoist': api,
  }).default;
  global.__superTaskButtonId = null; global.__superTaskDeepLink = initial.deepLink || null;
  let tree;
  await act(async () => {tree = create(React.createElement(App)); await flush();});
  return {tree, calls, Batch, Single,
    stallNextConfigRead() {let resolve; const promise = new Promise(done => {resolve = done;}); configReads.push(promise); return resolve;},
    async tap(label) {const button = byLabel(tree, label); assert.ok(button, `missing ${label}`); await act(async () => {await button.props.onPress(); await flush();});},
    async navigate(name, params) {await act(async () => {global.__superTaskNavigate(name, params); await flush();});},
    async dispose() {await act(async () => {tree.unmount(); await flush();});},
  };
}
function hiddenWrapper(component) {
  let parent = component.parent;
  while (parent && !Object.hasOwn(parent.props, 'importantForAccessibility')) parent = parent.parent;
  assert.ok(parent, 'screen must have an accessibility-aware stack wrapper');
  return parent;
}
function assertHidden(component) {
  const wrapper = hiddenWrapper(component);
  assert.equal(wrapper.props.style.display, 'none'); assert.equal(wrapper.props.pointerEvents, 'none');
  assert.equal(wrapper.props.accessibilityElementsHidden, true); assert.equal(wrapper.props.importantForAccessibility, 'no-hide-descendants');
}

test('real App retains batch saved list through task details and Back without another save', async () => {
  const f = await fixture();
  try {
    await f.tap('Start batch'); await f.tap('Save 2 tasks');
    assert.equal(f.calls.batches.length, 1); assert.ok(byLabel(f.tree, 'Open task Task one')); assert.ok(byLabel(f.tree, 'Open task Task two'));
    const form = f.tree.root.findByType(f.Batch);
    await f.tap('Open task Task one'); assert.equal(f.tree.root.findByType('Detail').props.task.content, 'Task one');
    assert.equal(f.tree.root.findByType(f.Batch), form, 'same mounted form instance'); assertHidden(form);
    await f.tap('Detail Back');
    assert.ok(byLabel(f.tree, 'Open task Task one')); assert.ok(byLabel(f.tree, 'Open task Task two'));
    assert.ok(f.tree.root.findAllByType('Text').some(text => text.props.children === 'Tasks saved'));
    assert.equal(hiddenWrapper(form).props.pointerEvents, 'auto'); assert.equal(hiddenWrapper(form).props.accessibilityElementsHidden, false);
    assert.equal(f.calls.batches.length, 1); assert.equal(f.tree.root.findAllByType('Input').length, 0, 'confirmation must not become an empty draft');
    await f.tap('Add another'); assert.ok(byLabel(f.tree, 'Save 1 task'));
  } finally {await f.dispose();}
});

test('App retains the native workspace and its draft and list position behind task details and Settings', async () => {
  const f = await fixture();
  try {
    const home = f.tree.root.findByType('Home');
    await f.tap('Edit workspace draft'); await f.tap('Scroll workspace list');
    assert.ok(f.tree.root.findAllByType('Text').some(text => text.props.children === 'Unsaved workspace draft'));
    assert.ok(f.tree.root.findAllByType('Text').some(text => text.props.children === 'List scrolled'));
    await f.tap('Open workspace detail');
    assert.equal(f.tree.root.findByType('Home'), home, 'workspace component instance stays mounted under task details');
    assertHidden(home);
    await f.tap('Detail Back');
    assert.equal(f.tree.root.findByType('Home'), home);
    await f.tap('Open workspace settings');
    assert.equal(f.tree.root.findByType('Home'), home, 'workspace component instance stays mounted under Settings');
    assertHidden(home);
    await f.tap('Settings Back');
    assert.equal(f.tree.root.findByType('Home'), home);
    assert.ok(f.tree.root.findAllByType('Text').some(text => text.props.children === 'Unsaved workspace draft'));
    assert.ok(f.tree.root.findAllByType('Text').some(text => text.props.children === 'List scrolled'));
  } finally {await f.dispose();}
});

test('real single-task confirmation and Add Another survive detail push/pop', async () => {
  const f = await fixture();
  try {
    await f.tap('Start single'); await f.tap('Save task'); assert.equal(f.calls.single.length, 1);
    const form = f.tree.root.findByType(f.Single);
    await f.tap('Single title'); assertHidden(form); await f.tap('Detail Back');
    assert.equal(f.tree.root.findByType(f.Single), form);
    assert.ok(f.tree.root.findAllByType('Text').some(text => text.props.children === 'Saved on this device'));
    assert.ok(byLabel(f.tree, 'Single title')); assert.ok(byLabel(f.tree, 'Done'));
    await f.tap('Add Another'); assert.equal(f.tree.root.findByProps({placeholder: 'What needs to be done?'}).props.value, '');
    assert.equal(f.calls.single.length, 1);
  } finally {await f.dispose();}
});

test('unsaved batch titles and exclusions survive Settings push/pop with the real form', async () => {
  const f = await fixture();
  try {
    await f.tap('Start batch');
    const inputs = f.tree.root.findAllByType('Input'); assert.equal(inputs.length, 2);
    await act(async () => {inputs[0].props.onChangeText('Edited unsaved title'); await flush();});
    const form = f.tree.root.findByType(f.Batch);
    await f.tap('Select none'); await f.tap('AI settings'); assertHidden(form);
    assert.equal(f.tree.root.findAllByType('Settings').length, 1);
    await f.tap('Settings Back');
    assert.equal(f.tree.root.findAllByType('Input')[0].props.value, 'Edited unsaved title');
    assert.ok(byLabel(f.tree, 'Save 0 tasks')); assert.equal(f.calls.batches.length, 0);
  } finally {await f.dispose();}
});

test('popped and reset task forms are discarded; new entries start with fresh state', async () => {
  const f = await fixture();
  try {
    await f.tap('Start batch'); await f.tap('Save 2 tasks'); await f.tap('Done');
    assert.equal(f.tree.root.findAllByType(f.Batch).length, 0);
    await f.tap('Start batch'); assert.ok(byLabel(f.tree, 'Save 2 tasks')); assert.equal(byLabel(f.tree, 'Open task Task one'), undefined);
    await f.navigate('task-batch', {projects, initialContent: 'Fresh reset'});
    assert.equal(f.tree.root.findAllByType(f.Batch).length, 1); assert.equal(f.tree.root.findByType('Input').props.value, 'Fresh reset');
    await f.navigate('task-home'); assert.equal(f.tree.root.findAllByType(f.Batch).length, 0);
    await f.tap('Start single'); await f.tap('Save task'); await f.tap('Done');
    assert.equal(f.tree.root.findAllByType(f.Single).length, 0);
    await f.tap('Start single'); assert.equal(byLabel(f.tree, 'Add Another'), undefined);
  } finally {await f.dispose();}
});

test('Capture is unmounted when another screen is pushed and is not retained behind Settings', async () => {
  const f = await fixture();
  try {
    await f.tap('Start capture'); assert.equal(f.calls.captureMounts, 1);
    await f.tap('Capture settings'); assert.equal(f.calls.captureUnmounts, 1);
    assert.equal(f.tree.root.findAllByType('Capture').length, 0);
    await f.tap('Settings Back'); assert.equal(f.calls.captureMounts, 2, 'Capture remount retains the established cancellation lifecycle');
  } finally {await f.dispose();}
});

test('App deep-link and navigation logs contain no task title or serialized task parameters', async () => {
  const f = await fixture({deepLink: {action: 'view-task', taskId: 'r'}});
  try {
    assert.equal(f.tree.root.findByType('Detail').props.task.content, 'PRIVATE_DEEP_LINK_TITLE');
    await f.navigate('task-batch', {projects, initialContent: 'PRIVATE_NAVIGATION_TITLE'});
    await f.tap('Save 1 task'); await f.tap('Open task PRIVATE_NAVIGATION_TITLE');
    const messages = JSON.stringify(f.calls.logs);
    assert.doesNotMatch(messages, /PRIVATE_DEEP_LINK_TITLE|PRIVATE_NAVIGATION_TITLE/);
  } finally {await f.dispose();}
});

test('Settings key save refreshes retained batch hint on Back without replacing its unsaved draft', async () => {
  const f = await fixture({config: {aiApiKey: '', aiSetupHintDismissed: false}});
  try {
    await f.tap('Start batch'); assert.ok(byLabel(f.tree, 'Set up AI'));
    await act(async () => {f.tree.root.findAllByType('Input')[0].props.onChangeText('Keep this edited draft'); await flush();});
    await f.tap('Select none'); await f.tap('Set up AI');
    assert.equal(f.tree.root.findByType(f.Batch).props.active, false);
    await f.tap('Save AI key'); await f.tap('Settings Back');
    assert.equal(f.tree.root.findByType(f.Batch).props.active, true);
    assert.equal(byLabel(f.tree, 'Set up AI'), undefined, 'new configured key removes setup hint');
    assert.equal(f.tree.root.findAllByType('Input')[0].props.value, 'Keep this edited draft');
    assert.ok(byLabel(f.tree, 'Save 0 tasks')); assert.equal(f.calls.batches.length, 0);
  } finally {await f.dispose();}
});

test('a deactivated batch cannot publish a stale config read after a newer Settings return', async () => {
  const f = await fixture();
  try {
    const finishOldRead = f.stallNextConfigRead();
    await f.tap('Start batch'); await f.tap('AI settings');
    await f.tap('Save AI key'); await f.tap('Settings Back');
    assert.equal(byLabel(f.tree, 'Set up AI'), undefined);
    await act(async () => {finishOldRead({postCreateAction: 'auto-back', aiApiKey: '', aiSetupHintDismissed: false}); await flush();});
    assert.equal(byLabel(f.tree, 'Set up AI'), undefined, 'stale hidden read must not overwrite current configuration');
    await f.tap('Save 2 tasks');
    assert.ok(byLabel(f.tree, 'Open task Task one'), 'stale auto-back setting must not replace Ask confirmation');
  } finally {await f.dispose();}
});
