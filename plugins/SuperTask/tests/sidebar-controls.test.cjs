const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const {act, create} = require('react-test-renderer');
const {visibleProjectIds, isProjectVisible, toggleProjectVisibility} = require('../src/utils/projectVisibility');
const {syncStatusMessage} = require('../src/offline/status');

global.IS_REACT_ACT_ENVIRONMENT = true;

function sidebarComponent() {
  const filename = path.resolve(__dirname, '../src/components/TaskSidebar.tsx');
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const normalRequire = mod.require.bind(mod);
  const native = {ScrollView: 'ScrollView', View: 'View', Text: 'Text', Pressable: 'Pressable', StyleSheet: {create: value => value}};
  const overrides = {'react-native': native, '../utils/useFontScale': {useFontScale: () => 1}};
  mod.require = name => Object.hasOwn(overrides, name) ? overrides[name] : normalRequire(name);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true},
  }).outputText, filename);
  return mod.exports.default;
}

const projects = [
  {id: 'inbox-id', name: 'Inbox', is_inbox_project: true},
  {id: 'home', name: 'Home'},
  {id: 'work', name: 'Work'},
];

test('legacy missing and empty enabledProjectIds keep every project checked and visible', () => {
  for (const config of [{}, {enabledProjectIds: []}]) {
    assert.deepEqual(visibleProjectIds(config, projects), ['inbox-id', 'home', 'work']);
    assert.equal(isProjectVisible(config, 'home', projects), true);
    assert.equal(isProjectVisible(config, 'work', projects), true);
  }
});

test('toggling one project from legacy all-visible creates an only-list and hides that project', () => {
  const patch = toggleProjectVisibility({enabledProjectIds: []}, 'work', projects);
  assert.deepEqual(patch, {projectVisibility: 'only', enabledProjectIds: ['home']});
  assert.deepEqual(visibleProjectIds(patch, projects), ['inbox-id', 'home']);
  assert.equal(isProjectVisible(patch, 'work', projects), false);
});

test('explicit only mode supports all-hidden while Inbox stays directly visible', () => {
  const config = {projectVisibility: 'only', enabledProjectIds: []};
  assert.deepEqual(visibleProjectIds(config, projects), ['inbox-id']);
  assert.equal(isProjectVisible(config, 'inbox-id', projects), true);
  assert.equal(isProjectVisible(config, 'home', projects), false);
});

test('only-list survives reload, keeps unavailable IDs, and leaves newly fetched projects hidden', () => {
  const first = toggleProjectVisibility({projectVisibility: 'only', enabledProjectIds: ['home', 'removed-id']}, 'home', projects);
  const savedAndReloaded = JSON.parse(JSON.stringify(first));
  assert.deepEqual(savedAndReloaded.enabledProjectIds, ['removed-id']);
  const laterProjects = [...projects, {id: 'new-project', name: 'New project'}];
  assert.deepEqual(visibleProjectIds(savedAndReloaded, laterProjects), ['inbox-id']);
  assert.equal(isProjectVisible(savedAndReloaded, 'new-project', laterProjects), false);
  const optedIn = toggleProjectVisibility(savedAndReloaded, 'new-project', laterProjects);
  assert.equal(isProjectVisible(optedIn, 'new-project', laterProjects), true);
});

test('Inbox visibility toggle is ignored and its sidebar destination is always present', async () => {
  assert.deepEqual(toggleProjectVisibility({projectVisibility: 'only', enabledProjectIds: []}, 'inbox-id', projects), {});
  const Sidebar = sidebarComponent();
  let tree;
  const opened = [];
  await act(async () => {tree = create(React.createElement(Sidebar, {activeView: 'inbox', projects, noteAvailable: false, counts: {}, onViewChange: view => opened.push(view)}));});
  const labels = tree.root.findAllByType('Pressable').map(node => node.props.accessibilityLabel);
  assert.deepEqual(labels, ['Today', 'Tomorrow', 'Upcoming', 'Inbox', 'On Device', 'Done', 'All projects', 'Home', 'Work']);
  const inboxItem = tree.root.findAllByType('Pressable').find(node => node.props.accessibilityLabel === 'Inbox');
  assert.equal(inboxItem.props.accessibilityState.selected, true);
  await act(async () => {inboxItem.props.onPress();});
  assert.deepEqual(opened, ['inbox']);
  await act(async () => {tree.unmount();});
});

test('sidebar keeps the requested order, conditionally adds This Note, and routes plain project clicks', async () => {
  const Sidebar = sidebarComponent();
  let tree;
  const opened = [];
  await act(async () => {tree = create(React.createElement(Sidebar, {
    activeView: 'project:work', projects, noteAvailable: true, visibleProjectIds: ['home', 'work'],
    counts: {today: 3, work: 7}, onViewChange: view => opened.push(view),
  }));});
  const pressables = tree.root.findAllByType('Pressable');
  assert.deepEqual(pressables.map(node => node.props.accessibilityLabel), [
    'Today', 'Tomorrow', 'Upcoming', 'Inbox', 'This Note', 'On Device', 'Done', 'All projects', 'Home', 'Work',
  ]);
  assert.equal(pressables.find(node => node.props.accessibilityLabel === 'Work').props.accessibilityState.selected, true);
  await act(async () => {pressables.at(-1).props.onPress();});
  assert.deepEqual(opened, ['project:work']);
  const buttons = tree.root.findAllByType('Pressable');
  assert.equal(buttons.some(node => /expand|collapse/i.test(node.props.accessibilityLabel || '')), false);
  assert.equal(buttons.find(node => node.props.accessibilityLabel === 'Today').findAllByType('Text').some(n => n.props.children === '3'), true);
  await act(async () => {tree.unmount();});
});

test('sync status distinguishes confirmed offline, auth, permissions, rate limits, and neutral reachability', () => {
  assert.equal(syncStatusMessage({syncError: {code: 'OFFLINE'}, pendingTaskCount: 2}), "You're offline. Reconnect to sync 2 tasks.");
  assert.equal(syncStatusMessage({syncError: {status: 401}, pendingTaskCount: 1}), 'Sign in again to sync 1 task.');
  assert.equal(syncStatusMessage({syncError: {status: 403}, pendingTaskCount: 1}), 'Permission is needed to sync 1 task.');
  assert.match(syncStatusMessage({syncError: {status: 429}, pendingTaskCount: 1}), /limiting requests/);
  assert.match(syncStatusMessage({syncError: 'Network request failed', pendingTaskCount: 1}), /Can't reach Todoist/);
  assert.doesNotMatch(syncStatusMessage({syncError: 'Network request failed', pendingTaskCount: 1}), /offline/i);
});

test('collection-only queue status never reports zero tasks and raw server details stay hidden', () => {
  assert.equal(syncStatusMessage({syncError: {code: 'OFFLINE'}, pendingCount: 1, pendingTaskCount: 0, pendingCollectionCount: 1}), "You're offline. Reconnect to sync 1 collection.");
  const message = syncStatusMessage({syncError: {status: 400, message: 'secret token response body'}, pendingCount: 2, pendingTaskCount: 1, pendingCollectionCount: 1});
  assert.equal(message, '1 task and 1 collection are saved and waiting to sync.');
  assert.doesNotMatch(message, /secret|token|response body/i);
  assert.equal(syncStatusMessage({pendingCount: 0}), '');
});
