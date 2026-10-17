const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const {act, create} = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const prefs = require('../src/workspace/viewPreferences');
const {rowIdentity, protectedOccurrence} = require('../src/workspace/intents');
const keyboardAvoidance = require('./keyboard-avoidance-mock.cjs');

test('workspace preferences normalize per view and keep accounts isolated', () => {
  const stored = {accounts: {'private-account-a': {'project:4': {view: 'board', groupBy: 'collection', sortBy: 'priority'}}}};
  assert.equal(prefs.normalizePreferences(prefs.preferencesForAccount(stored, 'private-account-a')['project:4'], 'project:4').view, 'board');
  assert.equal(prefs.normalizePreferences(prefs.preferencesForAccount(stored, 'private-account-b')['project:4'], 'project:4').view, 'list');
  assert.equal(prefs.normalizePreferences({view: 'unknown', groupBy: 'bad', sortBy: 'bad'}, 'upcoming').groupBy, 'date');
});

test('a local collapse survives a late settings read and later data refresh/remount', () => {
  const stored = {accounts: {'private-account-a': {today: {completedExpanded: true}}}};
  const queuedLocalChange = {today: {completedExpanded: false}};
  const lateRead = prefs.mergePreferencePatches(prefs.preferencesForAccount(stored, 'private-account-a'), queuedLocalChange);
  const refreshedRead = prefs.preferencesForAccount({accounts: {'private-account-a': lateRead}}, 'private-account-a');
  assert.equal(prefs.normalizePreferences(refreshedRead.today, 'today').completedExpanded, false);
  assert.equal(prefs.normalizePreferences(prefs.preferencesForAccount(stored, 'private-account-b').today, 'today').completedExpanded, false);
});

test('workspace sorting is presentation-only and undated tasks sort last', () => {
  const tasks = [
    {id: 'b', content: 'Zulu', priority: 4},
    {id: 'a', content: 'Alpha', priority: 1, due: {date: '2026-10-20'}},
    {id: 'c', content: 'Mike', priority: 2, due: {datetime: '2026-10-18T10:00:00'}},
    {id: 'd', content: 'Delta', priority: 2, due: {datetime: '2026-10-18T08:00:00'}},
  ];
  assert.deepEqual(prefs.sortTasks(tasks, 'manual').map(task => task.id), ['b', 'a', 'c', 'd']);
  assert.deepEqual(prefs.sortTasks(tasks, 'priority').map(task => task.id), ['b', 'c', 'd', 'a']);
  assert.deepEqual(prefs.sortTasks(tasks, 'due').map(task => task.id), ['d', 'c', 'a', 'b']);
  assert.deepEqual(prefs.sortTasks(tasks, 'title').map(task => task.id), ['a', 'd', 'c', 'b']);
  assert.deepEqual(tasks.map(task => task.id), ['b', 'a', 'c', 'd']);
});

test('due-time sorting and date grouping normalize offset timestamps across local midnight', () => {
  const tasks = [
    {id: 'late', due: {datetime: '2026-10-17T23:30:00-02:00'}},
    {id: 'early', due: {datetime: '2026-10-18T01:00:00+02:00'}},
    {id: 'floating', due: {datetime: '2026-10-20T01:15:00'}},
  ];
  assert.deepEqual(prefs.sortTasks(tasks, 'due').map(task => task.id), ['early', 'late', 'floating']);
  const localDay = require('../src/components/taskDueLabel').getDueDateTimeKey(tasks[0].due.datetime).slice(0, 10);
  const grouped = prefs.groupTasks(tasks, 'date', {today: '2026-10-16'});
  assert.equal(grouped.find(group => group.tasks.some(task => task.id === 'late')).title, localDay);
  assert.deepEqual(tasks.map(task => task.id), ['late', 'early', 'floating']);
});

test('board grouping keeps no-collection and date buckets explicit', () => {
  const groups = prefs.groupTasks([
    {id: '1', section_id: 's', project_id: 'p', due: {date: '2026-10-19'}},
    {id: '2', project_id: 'p'},
    {id: '3', project_id: 'p', due: {date: '2026-10-15'}},
  ], 'collection', {projectId: 'p', includeEmptyCollections: true, collections: [{id: 's', name: 'Work', project_id: 'p'}]});
  assert.deepEqual(groups.map(group => [group.title, group.tasks.length]), [['No collection', 2], ['Work', 1]]);
  assert.deepEqual(prefs.groupTasks([{id: 'x', due: {date: '2026-10-15'}}, {id: 'y'}], 'date', {today: '2026-10-17'}).map(group => group.title), ['Overdue', 'Undated']);
});

test('selected-project collection columns persist when empty and stay ordered after row sorting or completion', () => {
  const projects = [{id: 'p', name: 'Project'}];
  const collections = [{id: 's2', name: 'Second', project_id: 'p', section_order: 2}, {id: 's1', name: 'First', project_id: 'p', section_order: 1}];
  const tasks = [{id: '2', content: 'Alpha', project_id: 'p', section_id: 's2'}, {id: '1', content: 'Zulu', project_id: 'p', section_id: 's1'}];
  const options = {projects, collections, projectId: 'p', includeEmptyCollections: true};
  const initial = prefs.groupTasks(prefs.sortTasks(tasks, 'title'), 'collection', options);
  const afterCompletion = prefs.groupTasks(prefs.sortTasks(tasks.filter(task => task.id !== '2'), 'title'), 'collection', options);
  assert.deepEqual(initial.map(group => group.title), ['No collection', 'First', 'Second']);
  assert.deepEqual(afterCompletion.map(group => group.key), initial.map(group => group.key));
  assert.equal(afterCompletion.find(group => group.title === 'Second').tasks.length, 0);
});

test('collection columns with repeated names are labeled by project in broad views', () => {
  const groups = prefs.groupTasks([
    {id: 'a', project_id: 'p', section_id: 's1'}, {id: 'b', project_id: 'q', section_id: 's2'},
  ], 'collection', {projects: [{id: 'p', name: 'Home'}, {id: 'q', name: 'Work'}], collections: [
    {id: 's1', project_id: 'p', name: 'General'}, {id: 's2', project_id: 'q', name: 'General'},
  ]});
  assert.deepEqual(groups.map(group => group.title), ['Home / General', 'Work / General']);
});

test('board presentation preserves recurring occurrence identity and history protection', () => {
  const occurrence = {id: '42', completed: true, occurrenceHistory: true, occurrenceCompletedAt: '2026-10-05T09:00:00Z', due: {is_recurring: true}};
  const next = Object.assign({}, occurrence, {completed: false, occurrenceHistory: false});
  const rows = prefs.groupTasks([occurrence, next], 'project', {projects: [{id: 'p', name: 'Project'}]});
  assert.deepEqual(rows[0].tasks.map(rowIdentity), [rowIdentity(occurrence), rowIdentity(next)]);
  assert.notEqual(rowIdentity(occurrence), rowIdentity(next));
  assert.equal(protectedOccurrence(occurrence), true);
});

test('selection actions remain in a fixed-height horizontal scroll slot', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/components/WorkspaceSelectionBar.tsx'), 'utf8');
  const home = fs.readFileSync(path.join(__dirname, '../src/screens/TaskHome.tsx'), 'utf8');
  const boardSource = fs.readFileSync(path.join(__dirname, '../src/components/WorkspaceBoard.tsx'), 'utf8');
  const fakeReactNative = {View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', StyleSheet: {create: value => value}};
  const filename = path.join(__dirname, '../src/components/WorkspaceSelectionBar.tsx');
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod.require = request => request === 'react-native' ? fakeReactNative : request === '../utils/useFontScale' ? {useFontScale: () => 1} : require(request);
  mod._compile(ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true}}).outputText, filename);
  const SelectionBar = mod.exports.default;
  let renderer;
  act(() => {renderer = create(React.createElement(SelectionBar, {count: 2, onCancel() {}, onMove() {}, onDate() {}, onMore() {}, onSelectAll() {}}));});
  const scroll = renderer.root.findByType('ScrollView');
  assert.equal(scroll.props.horizontal, true);
  assert.match(home, /height: Math\.max\(76,/);
  assert.match(home, /pointerEvents=\{selectionMode \? 'none' : 'auto'\}/);
  assert.match(home, /composerHidden: \{opacity: 0\}/);
  assert.match(home, /if \(viewPreferences\.sortBy !== 'manual'\) return false/);
  assert.match(home, /getCachedWorkspace\(\)\?\.accountKey/);
  assert.match(home, /revision === preferenceRevision\.current \? loaded : mergePreferencePatches/);
  const board = home.slice(home.indexOf('const renderWorkspaceBoard ='), home.indexOf('const excludedKeepProjects ='));
  assert.match(board, /key: 'workspace-completed'/);
  assert.match(board, /header: <SectionHeader title="Completed"/);
  assert.doesNotMatch(board, /renderCompletedSection\(\)/);
  assert.doesNotMatch(boardSource, /<FlatList horizontal/);
  assert.match(boardSource, /paginateGroups/);
  assert.match(boardSource, /<FlatList data=\{item\.tasks\}/);
});

test('an expanded description keeps its rendered height through multiselect while quick actions hide', () => {
  const native = {View: 'View', Text: 'Text', Pressable: 'Pressable', StyleSheet: {create: value => value}};
  const loadTs = (relative, overrides = {}) => {
    const filename = path.join(__dirname, relative);
    const mod = new Module(filename, module); mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
    const normal = mod.require.bind(mod); mod.require = name => Object.hasOwn(overrides, name) ? overrides[name] : normal(name);
    mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true}}).outputText, filename);
    return mod.exports;
  };
  const actualTaskRow = loadTs('../src/components/TaskRow.tsx', {'react-native': native,
    '../utils/debug': {log() {}}, '../utils/useFontScale': {useFontScale: () => 1},
    './settings': {Check: 'Check'}, './Chip': {__esModule: true, default: 'Chip'}}).default;
  const workspaceTaskRow = loadTs('../src/workspace/WorkspaceTaskRow.tsx', {'react-native': native,
    '../components/TaskRow': {__esModule: true, default: actualTaskRow},
    '../components/TaskQuickActions': {__esModule: true, default: 'QuickActions'}});
  const context = (selectionMode, selectedIds) => ({selectionMode, selectedIds, expandedId: 'task', identity: task => task.id,
    project: task => task, protectedHistory: () => false, canSelect: () => true, toggle() {}, select() {}, expand() {},
    complete() {}, retryCreate() {}, edit() {}, action() {}, canOrder: () => false, order() {}});
  const task = {id: 'task', content: 'Task', description: 'The details stay visible.'};
  let tree;
  act(() => {tree = create(React.createElement(workspaceTaskRow.WorkspaceContext.Provider, {value: context(false, [])},
    React.createElement(workspaceTaskRow.default, {task, onPress() {}, onCheckPress() {}})));});
  const description = () => tree.root.findByProps({accessibilityLabel: 'Description: The details stay visible.'});
  const originalStyle = description().props.style;
  assert.equal(tree.root.findAllByType('QuickActions').length, 1);
  act(() => tree.update(React.createElement(workspaceTaskRow.WorkspaceContext.Provider, {value: context(true, ['task'])},
    React.createElement(workspaceTaskRow.default, {task, onPress() {}, onCheckPress() {}}))));
  assert.deepEqual(description().props.style, originalStyle);
  assert.equal(tree.root.findAllByType('QuickActions').length, 0);
  act(() => tree.unmount());
});

test('collapsed Completed board column has no empty-task message', () => {
  const native = {View: 'View', Text: 'Text', Pressable: 'Pressable', StyleSheet: {create: value => value}, FlatList: ({data = [], renderItem, ListEmptyComponent, ListFooterComponent, ...props}) =>
    React.createElement('List', props, ...(data.length ? data.map((item, index) => React.createElement(React.Fragment, {key: index}, renderItem({item}))) : [ListEmptyComponent]), ListFooterComponent)};
  const filename = path.join(__dirname, '../src/components/WorkspaceBoard.tsx');
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const normal = mod.require.bind(mod);
  mod.require = name => name === 'react-native' ? native : name === './KeyboardAvoidance' ? keyboardAvoidance : name === '../utils/useFontScale' ? {useFontScale: () => 1} : normal(name);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true}}).outputText, filename);
  const Board = mod.exports.default;
  let tree;
  act(() => {tree = create(React.createElement(Board, {groups: [
    {key: 'regular', title: 'Regular', tasks: []}, {key: 'workspace-completed', title: 'Completed', tasks: [], emptyMessage: null},
  ], renderTask: () => null, taskKey: task => task.id}));});
  const emptyLabels = tree.root.findAllByType('Text').map(node => node.props.children);
  assert.ok(emptyLabels.includes('No tasks'));
  assert.equal(emptyLabels.filter(label => label === 'No tasks').length, 1, 'only the regular empty column has its placeholder');
  act(() => tree.unmount());
});

test('project picker commits immediately only when its opt-in is enabled', () => {
  const filename = path.join(__dirname, '../src/components/ProjectPicker.tsx');
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const native = {View: 'View', Text: 'Text', TextInput: 'Input', Pressable: 'Pressable', StyleSheet: {create: value => value}};
  const normal = mod.require.bind(mod);
  mod.require = name => name === 'react-native' ? native : name === './KeyboardAvoidance' ? keyboardAvoidance : name === '../utils/useFontScale' ? {useFontScale: () => 1} : normal(name);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true}}).outputText, filename);
  const Picker = mod.exports.default;
  const commits = []; let renderer;
  act(() => {renderer = create(React.createElement(Picker, {projects: [{id: 'p', name: 'Project'}], sections: [], selectedId: 'p', commitOnSelect: true, onChange() {}, onSectionChange() {}, onCommitSelection: (...args) => commits.push(args)}));});
  act(() => renderer.root.findByProps({accessibilityLabel: 'Choose collection No collection'}).props.onPress());
  assert.deepEqual(commits, [['p', null]]);
  act(() => renderer.unmount());
});
