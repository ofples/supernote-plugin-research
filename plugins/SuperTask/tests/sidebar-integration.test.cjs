const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const {act, create} = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
function load(file, overrides = {}) {
  const filename = path.resolve(__dirname, file); const mod = new Module(filename, module);
  mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const normal = mod.require.bind(mod);
  mod.require = name => Object.hasOwn(overrides, name) ? overrides[name] : normal(name);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true,
  }}).outputText, filename); return mod.exports;
}
const native = {TextInput: 'TextInput', View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView',
  Modal: props => props.visible ? React.createElement('Modal', props, props.children) : null,
  StyleSheet: {create: value => value}, FlatList: ({data, renderItem}) => React.createElement('List', {}, data.map(item =>
    React.createElement('ListItem', {key: item.key || item.id}, renderItem({item}))))};
function workspace(config = {}, note = false, extraTasks = []) {
  const today = require('../src/offline/model').localDate(new Date());
  const next = new Date(); next.setDate(next.getDate() + 1);
  const tomorrow = require('../src/offline/model').localDate(next);
  const tasks = [{id: 'one', content: 'Due task', project_id: 'p', section_id: 's', due: {date: today}, source: {filePath: '/note/Test.note', pageNum: 2}, syncState: 'synced'},
    {id: 'two', content: 'Tomorrow task', project_id: 'p', due: {date: tomorrow}, syncState: 'synced'},
    {id: 'inbox', content: 'Inbox task', project_id: 'i', syncState: 'pending'}, ...extraTasks];
  let data = {tasks, allTasks: tasks, projects: [{id: 'p', name: 'Work'}, {id: 'i', name: 'Inbox', is_inbox_project: true}],
    sections: [{id: 's', name: 'Writing', project_id: 'p'}], pendingCount: 2, pendingTaskCount: 1, pendingCollectionCount: 1,
    pendingChanges: [{id: 'inbox', uuid: 'a', kind: 'create', state: 'attention', error: {status: 401}, task: tasks[2]},
      {id: 's', uuid: 'b', kind: 'collection_create', state: 'pending', collection: {name: 'Writing'}}]};
  const completed = []; const reopened = []; const retries = []; const navCalls = []; const savedDrafts = [];
  let finishProject; const projectGate = new Promise(resolve => {finishProject = resolve;});
  let session = null;
  const api = {completeTask: async id => {completed.push(id); data = {...data, tasks: data.tasks.filter(task => task.id !== id),
    allTasks: data.allTasks.map(task => task.id === id ? {...task, completed: true} : task)};}, reopenTask: async id => {
    reopened.push(id); data = {...data, allTasks: data.allTasks.map(task => task.id === id ? {...task, completed: false} : task)};
    data.tasks = data.allTasks.filter(task => !task.completed && !task.deleted);
  }, getCompletedTasks: async () => data.allTasks.filter(task => task.completed), refreshCompletedTasks: async () => data.allTasks.filter(task => task.completed)};
  const hook = load('../src/utils/useTaskSelection.ts', {'../api/todoist': api}).useTaskSelection;
  let frozenReferences;
  const references = () => frozenReferences || data.allTasks.filter(task => task.source).map(task => ({...task, notePath: task.source.filePath, pageNum: task.source.pageNum}));
  const service = {offlineData: async () => data, completedData: async () => data.allTasks.filter(task => task.completed),
    subscribeOffline: () => () => {}, retryOffline: async id => {retries.push(id);},
    mutateOfflineTasks: async (ids, action) => {for (const id of ids) {
      if (action.kind === 'complete') await (action.completed ? api.completeTask : api.reopenTask)(id);
    }}, saveOfflineBatch: async (drafts, source, capturedAt, request) => {savedDrafts.push({drafts, source, request}); return [];},
    createOfflineProject: async name => {await projectGate; const project = {id: 'saved-local-project', name}; data = {...data, projects: [...data.projects, project]}; return project;} };
  const mutations = load('../src/workspace/useWorkspaceMutations.ts', {'../offline/service': service}).default;
  const rowModule = load('../src/workspace/WorkspaceTaskRow.tsx', {'react-native': native,
    '../components/TaskRow': {__esModule: true, default: 'TaskRow'}, '../components/TaskQuickActions': {__esModule: true, default: 'QuickActions'}});
  const view = load('../src/screens/TaskHome.tsx', {
    'react-native': native, 'sn-plugin-lib': {PluginCommAPI: {getCurrentFilePath: async () => ({success: true, result: note ? '/note/Test.note' : ''}),
      getCurrentPageNum: async () => ({success: true, result: 0})}, PluginFileAPI: {getElements: async () => ({success: true, result: []})}},
    '../utils/closePlugin': {closePlugin() {}}, '../utils/taskRegistry': {getAllTasks: async () => references(), getTasksForNote: async () => references(), getTask: async () => null},
    '../utils/noteOpener': {}, '../utils/noteHeal': {healRenamedNotes: async () => 0}, '../utils/noteLabel': {noteLabel: () => 'Test'},
    '../utils/config': {getCachedConfig: () => config, loadConfig: async () => config, resolveDefaultTab: cfg => cfg?.defaultTab || 'today', saveConfig: async () => {}},
    '../utils/useFontScale': {useFontScale: () => 1}, '../components/settings': {Check: 'Check'},
    '../utils/viewState': {getSessionTab: () => session, setSessionTab: value => {session = value;}}, '../api/todoist': api,
    '../cache/taskCache': {getCache: () => data, fetchTaskData: async () => data, initTaskCache: async () => data, invalidateCache() {}, subscribeCache: () => () => {}},
    '../offline/service': service, '../workspace/useWorkspaceMutations': {__esModule: true, default: mutations},
    '../workspace/WorkspaceTaskRow': {...rowModule, __esModule: true},
    '../components/NativeTaskSidebar': {__esModule: true, default: 'Sidebar'},
    '../components/InlineTaskComposer': {__esModule: true, default: 'Composer'},
    '../components/WorkspaceSelectionBar': {__esModule: true, default: 'Selection'},
    '../components/DatePicker': {__esModule: true, default: 'DatePicker'},
    '../components/ProjectPicker': {__esModule: true, default: 'ProjectPicker'},
    '../components/PriorityPicker': {__esModule: true, default: 'PriorityPicker'},
    '../utils/debug': {log() {}, logError() {}}, '../utils/useTaskSelection': {useTaskSelection: hook},
    '../components/TaskSidebar': {__esModule: true, default: 'Sidebar'}, '../components/TaskRow': {__esModule: true, default: 'TaskRow'},
    '../components/ProjectOverview': {__esModule: true, default: 'Overview'}, '../components/SelectionBar': {__esModule: true, default: 'UndoBar'},
    '../components/SectionHeader': {__esModule: true, default: 'Section'}, '../components/Chip': {__esModule: true, default: 'Chip'},
  });
  const nav = {push: (...args) => navCalls.push(args)};
  return {Home: view.default, normalize: view.normalizeTaskView, syncChangeLabel: view.syncChangeLabel, nav, completed, reopened, retries, navCalls, savedDrafts, config, service, updateData: update => {data = update(data);},
    finishProject, freezeReferences: () => {frozenReferences = references().map(reference => ({...reference}));},
    markMissing: (id, leakIntoActive = false) => {
      data = {...data, allTasks: data.allTasks.map(task => task.id === id ? {...task, remoteId: 'acknowledged-remote', remoteMissing: true} : task)};
      data.tasks = data.allTasks.filter(task => !task.completed && !task.deleted && (leakIntoActive || !task.remoteMissing));
    },
    tombstone: id => {data = {...data, allTasks: data.allTasks.map(task => task.id === id ? {...task, deleted: true} : task), tasks: data.tasks.filter(task => task.id !== id)};},
    awaiting: id => {data = {...data, allTasks: data.allTasks.map(task => task.id === id ? {...task, completed: false, awaitingRecurrence: true, occurrencePending: true} : task), tasks: data.tasks.filter(task => task.id !== id)};},
    nextOccurrence: id => {data = {...data, allTasks: data.allTasks.map(task => task.id === id ? {...task, completed: false, awaitingRecurrence: false, occurrencePending: false, due: {date: tomorrow, is_recurring: true}} : task)}; data.tasks = data.allTasks.filter(task => !task.completed && !task.deleted);} };
}
const switchTo = async (tree, view) => act(async () => tree.root.findByType('Sidebar').props.onViewChange(view));
test('legacy Pending destination migrates to Today and opens the sync summary', async () => {
  const model = workspace({defaultTab: 'pending'}); let tree;
  assert.equal(model.normalize('pending'), 'today'); assert.equal(model.normalize('project:p'), 'project:p');
  await act(async () => {tree = create(React.createElement(model.Home, {nav: model.nav}));});
  assert.equal(tree.root.findByType('Sidebar').props.activeView, 'today');
  assert.equal(tree.root.findAllByType('Modal').length, 1);
  await act(async () => tree.unmount());
});
test('project sidebar choice preserves navigation and groups collections in the pane; Tomorrow and Inbox are distinct', async () => {
  const model = workspace(); let tree;
  await act(async () => {tree = create(React.createElement(model.Home, {nav: model.nav}));});
  await switchTo(tree, 'project:p');
  assert.equal(tree.root.findByType('Sidebar').props.activeView, 'project:p');
  assert.deepEqual(tree.root.findAllByType('Section').map(n => n.props.title), ['No collection', 'Writing']);
  assert.equal(tree.root.findAllByType('TaskRow').length, 2); assert.equal(model.navCalls.length, 0);
  await switchTo(tree, 'tomorrow'); assert.deepEqual(tree.root.findAllByType('TaskRow').map(n => n.props.task.id), ['two']);
  await switchTo(tree, 'inbox'); assert.deepEqual(tree.root.findAllByType('TaskRow').map(n => n.props.task.id), ['inbox']);
  await switchTo(tree, 'projects'); assert.equal(tree.root.findAllByType('Overview').length, 1);
  await act(async () => tree.unmount());
});
test('checkbox completes immediately, title expands quick actions, and completed footer reopens without an Undo banner', async () => {
  const model = workspace({}, true); let tree;
  await act(async () => {tree = create(React.createElement(model.Home, {nav: model.nav}));});
  await switchTo(tree, 'note');
  assert.equal(tree.root.findByType('Sidebar').props.noteAvailable, true);
  const row = tree.root.findByType('TaskRow');
  await act(async () => row.props.onPress(row.props.task));
  assert.equal(model.navCalls.length, 0);
  assert.equal(row.props.outlineSelected, true);
  assert.equal(row.props.rightAccessory.type, 'QuickActions');
  assert.equal(tree.root.findAllByType('TaskRow').length, 1);
  await act(async () => row.props.rightAccessory.props.onEdit());
  assert.equal(model.navCalls[0][0], 'task-detail');
  await act(async () => row.props.onCheckPress('one'));
  assert.deepEqual(model.completed, ['one']); assert.equal(tree.root.findAllByType('TaskRow').length, 1);
  assert.equal(tree.root.findAllByType('UndoBar').length, 0);
  await act(async () => tree.root.findByType('TaskRow').props.onCheckPress('one'));
  assert.deepEqual(model.reopened, ['one']); assert.equal(tree.root.findAllByType('TaskRow').length, 1);
  await switchTo(tree, 'device'); assert.equal(tree.root.findAllByType('TaskRow').length, 1);
  await act(async () => tree.unmount());
});
test('explicit all-hidden project mode filters time views but leaves Inbox and physical note tasks available', async () => {
  const model = workspace({projectVisibility: 'only', enabledProjectIds: []}, true); let tree;
  await act(async () => {tree = create(React.createElement(model.Home, {nav: model.nav}));});
  assert.equal(tree.root.findAllByType('TaskRow').length, 0);
  assert.deepEqual(tree.root.findByType('Sidebar').props.visibleProjectIds, ['i']);
  await switchTo(tree, 'note'); assert.equal(tree.root.findAllByType('TaskRow').length, 1);
  await switchTo(tree, 'inbox'); assert.equal(tree.root.findAllByType('TaskRow').length, 1);
  await switchTo(tree, 'project:p'); assert.equal(tree.root.findAllByType('TaskRow').length, 0);
  assert.match(JSON.stringify(tree.toJSON()), /This project is hidden/);
  await act(async () => tree.unmount());
});
test('sync summary includes collection and task queue work and retries a saved failure', async () => {
  const model = workspace(); let tree;
  await act(async () => {tree = create(React.createElement(model.Home, {nav: model.nav}));});
  await act(async () => tree.root.findByProps({accessibilityLabel: 'Open sync summary'}).props.onPress());
  const text = JSON.stringify(tree.toJSON()); assert.match(text, /Writing/); assert.match(text, /Create collection/); assert.match(text, /Sign in again/);
  assert.equal(model.syncChangeLabel('delete'), 'Delete task');
  assert.equal(model.syncChangeLabel('recurring_complete'), 'Complete recurring occurrence');
  await act(async () => tree.root.findByProps({accessibilityLabel: 'Retry saved change'}).props.onPress());
  assert.deepEqual(model.retries, ['inbox']);
  await act(async () => tree.unmount());
});
test('shared hook blocks rapid duplicate completion and preserves failed undo for an honest retry', async () => {
  let resolve; let calls = 0; const errors = []; let hook;
  const useTaskSelection = load('../src/utils/useTaskSelection.ts', {'../api/todoist': {
    completeTask: async () => {calls++; await new Promise(done => {resolve = done;});},
    reopenTask: async () => {throw Object.assign(new Error('private response'), {code: 'RECURRING_UNDO_UNSUPPORTED'});},
  }}).useTaskSelection;
  function Surface() {hook = useTaskSelection('test', {onError: msg => errors.push(msg)}); return null;}
  let tree; await act(async () => {tree = create(React.createElement(Surface));});
  let pending;
  await act(async () => {pending = hook.completeOne('task'); hook.completeOne('task');});
  assert.equal(calls, 1); assert.equal(hook.busy, true);
  await act(async () => {resolve(); await pending;}); assert.deepEqual(hook.undoIds, ['task']);
  await act(async () => hook.undo()); assert.deepEqual(hook.undoIds, ['task']);
  assert.match(errors[0], /already synced/); assert.doesNotMatch(errors[0], /private response/);
  await act(async () => tree.unmount());
});
test('shared row checkbox and sync symbol stop propagation to detail action', async () => {
  const checked = []; const opened = []; const synced = [];
  const Row = load('../src/components/TaskRow.tsx', {'react-native': native,
    '../utils/debug': {log() {}}, '../utils/useFontScale': {useFontScale: () => 1},
    './settings': {Check: 'Check'}, './Chip': {__esModule: true, default: 'Chip'},
  }).default;
  let tree; await act(async () => {tree = create(React.createElement(Row, {task: {id: 'a', content: 'Task', syncState: 'pending'},
    onCheckPress: id => checked.push(id), onPress: task => opened.push(task.id), onSyncPress: () => synced.push(true)}));});
  let stops = 0;
  tree.root.findByProps({accessibilityLabel: 'Complete Task'}).props.onPress({stopPropagation: () => {stops++;}});
  tree.root.findByProps({accessibilityLabel: 'Saved on device, waiting to sync'}).props.onPress({stopPropagation: () => {stops++;}});
  assert.equal(stops, 2); assert.deepEqual(checked, ['a']); assert.equal(opened.length, 0); assert.equal(synced.length, 1);
  await act(async () => tree.unmount());
});

const pressRefresh = tree => tree.root.findAllByType('Pressable').find(node => node.findAllByType('Text').some(text => text.props.children === 'Refresh')).props.onPress();
for (const leakIntoActive of [false, true]) {
  test(`missing acknowledged tasks cannot reappear through stale note references${leakIntoActive ? ' or an old active cache' : ''}; pending task counts stay accurate`, async () => {
    const source = {filePath: '/note/Test.note', pageNum: 3};
    const model = workspace({}, true, [
      {id: 'local:unsent', content: 'Unsent task', project_id: 'p', source, syncState: 'pending'},
      {id: 'remote:pending', remoteId: 'pending-remote', ackPendingRefresh: true, content: 'Pending change', project_id: 'p', source, syncState: 'pending'},
    ]);
    let tree;
    await act(async () => {tree = create(React.createElement(model.Home, {nav: model.nav}));});
    model.freezeReferences();
    await switchTo(tree, 'note');
    assert.equal(tree.root.findAllByType('TaskRow').length, 3);
    model.markMissing('one', leakIntoActive);
    await act(async () => pressRefresh(tree));
    const expectedIds = ['local:unsent', 'remote:pending'];
    assert.deepEqual(tree.root.findAllByType('TaskRow').map(row => row.props.task.id), expectedIds);
    assert.equal(tree.root.findByType('Sidebar').props.counts.note, 2);
    assert.equal(tree.root.findByType('Sidebar').props.counts.device, 2);
    await switchTo(tree, 'device');
    assert.deepEqual(tree.root.findAllByType('TaskRow').map(row => row.props.task.id), expectedIds);
    assert.equal(tree.root.findByType('Sidebar').props.counts.device, tree.root.findAllByType('TaskRow').length);
    assert.equal(tree.root.findAllByType('TaskRow').every(row => row.props.task.syncState === 'pending'), true);
    await switchTo(tree, 'today');
    assert.equal(tree.root.findAllByType('TaskRow').some(row => row.props.task.id === 'one'), false);
    await act(async () => tree.unmount());
  });
}
test('deleted tasks and acknowledged recurring occurrences stay absent from registry fallback; next occurrence reappears', async () => {
  const model = workspace({}, true); let tree;
  await act(async () => {tree = create(React.createElement(model.Home, {nav: model.nav}));});
  await switchTo(tree, 'note'); assert.equal(tree.root.findAllByType('TaskRow').length, 1);
  model.awaiting('one');
  await act(async () => pressRefresh(tree)); assert.equal(tree.root.findAllByType('TaskRow').length, 0);
  await switchTo(tree, 'device'); assert.equal(tree.root.findAllByType('TaskRow').length, 0);
  model.nextOccurrence('one');
  await act(async () => pressRefresh(tree)); assert.equal(tree.root.findAllByType('TaskRow').length, 1);
  await switchTo(tree, 'note'); assert.equal(tree.root.findAllByType('TaskRow').length, 1);
  model.tombstone('one');
  await act(async () => pressRefresh(tree)); assert.equal(tree.root.findAllByType('TaskRow').length, 0);
  await switchTo(tree, 'device'); assert.equal(tree.root.findAllByType('TaskRow').length, 0);
  await act(async () => tree.unmount());
});

test('All projects uses the same immediate checkbox action; collapsing projects never completes concealed tasks', async () => {
  const completed = [];
  const Overview = load('../src/components/ProjectOverview.tsx', {'react-native': native,
    '../utils/useFontScale': {useFontScale: () => 1}, './TaskRow': {__esModule: true, default: 'TaskRow'}, '../workspace/WorkspaceTaskRow': {__esModule: true, default: 'TaskRow'},
  }).default;
  let tree;
  await act(async () => {tree = create(React.createElement(Overview, {projects: [{id: 'p', name: 'Work'}],
    tasks: [{id: 'a', project_id: 'p', content: 'Task'}], selectedIds: [], onSelect: id => completed.push(id), onTask() {}, onProject() {}}));});
  await act(async () => tree.root.findByProps({accessibilityLabel: 'Expand Work'}).props.onPress());
  tree.root.findByType('TaskRow').props.onCheckPress('a'); assert.deepEqual(completed, ['a']);
  await act(async () => tree.root.findByProps({accessibilityLabel: 'Collapse Work'}).props.onPress());
  assert.deepEqual(completed, ['a']);
  await act(async () => tree.unmount());
});
test('inline draft survives a view change with note source and submits once under rapid duplicate events', async () => {
  const model = workspace({defaultProjectId: 'p', defaultSectionId: 's'}, true); let tree;
  await act(async () => {tree = create(React.createElement(model.Home, {nav: model.nav}));});
  assert.equal(tree.root.findByType('Composer').props.destinationLabel, 'Inbox');
  await switchTo(tree, 'note');
  await act(async () => tree.root.findByType('Composer').props.onChangeText('Draft — description'));
  await switchTo(tree, 'tomorrow');
  assert.equal(tree.root.findByType('Composer').props.value, 'Draft — description');
  assert.equal(tree.root.findByType('Composer').props.destinationLabel, 'Work / Writing');
  const submit = tree.root.findByType('Composer').props.onSubmit;
  await act(async () => {submit(); submit();});
  assert.equal(model.savedDrafts.length, 1);
  assert.deepEqual(model.savedDrafts[0].source, {filePath: '/note/Test.note', pageNum: 0});
  assert.equal(model.savedDrafts[0].drafts[0].content, 'Draft');
  assert.equal(model.savedDrafts[0].drafts[0].description, 'description');
  assert.equal(model.savedDrafts[0].drafts[0].projectId, 'p');
  await act(async () => tree.unmount());
});
test('Upcoming requires a chosen date; completed collapse state belongs to each view', async () => {
  const model = workspace(); let tree;
  await act(async () => {tree = create(React.createElement(model.Home, {nav: model.nav}));});
  const footer = () => tree.root.findByProps({accessibilityLabel: 'Expand completed tasks'});
  assert.equal(footer().props.accessibilityState.expanded, true);
  await act(async () => footer().props.onPress());
  await switchTo(tree, 'upcoming'); assert.equal(footer().props.accessibilityState.expanded, true);
  await act(async () => tree.root.findByType('Composer').props.onChangeText('Task without a date'));
  await act(async () => tree.root.findByType('Composer').props.onSubmit());
  assert.equal(model.savedDrafts.length, 0);
  assert.match(JSON.stringify(tree.toJSON()), /Choose a calendar date/);
  await switchTo(tree, 'today'); assert.equal(footer().props.accessibilityState.expanded, false);
  await act(async () => tree.unmount());
});
test('a syncing project alias keeps project rows and composer location available', async () => {
  const model = workspace(); let tree;
  model.updateData(data => ({...data, projects: [...data.projects, {id: 'local-project', name: 'Offline project'}], tasks: [...data.tasks, {id: 'local-task', project_id: 'local-project', content: 'Local task'}]}));
  await act(async () => {tree = create(React.createElement(model.Home, {nav: model.nav}));});
  await switchTo(tree, 'project:local-project');
  await act(async () => tree.root.findByType('Composer').props.onChangeText('Preserved draft'));
  model.updateData(data => ({...data, projects: data.projects.map(project => project.id === 'local-project' ? {...project, id: 'remote-project', localId: 'local-project'} : project),
    tasks: data.tasks.map(task => task.project_id === 'local-project' ? {...task, project_id: 'remote-project'} : task)}));
  await act(async () => pressRefresh(tree));
  assert.equal(tree.root.findByType('Sidebar').props.activeView, 'project:remote-project');
  assert.equal(tree.root.findByType('Composer').props.destinationLabel, 'Offline project');
  assert.equal(tree.root.findByType('TaskRow').props.task.content, 'Local task');
  await act(async () => tree.root.findByType('Composer').props.onSubmit());
  assert.equal(model.savedDrafts[0].drafts[0].projectId, 'remote-project');
  await act(async () => tree.unmount());
});
test('completed recurring occurrence cannot be selected or reopened through the active next task', async () => {
  const history = {id: 'one', project_id: 'p', content: 'Previous occurrence', completed: true, occurrenceHistory: true, completed_at: '2026-10-04', due: {date: '2026-10-04', is_recurring: true}};
  const model = workspace({}, false, [history]); let tree;
  await act(async () => {tree = create(React.createElement(model.Home, {nav: model.nav}));});
  const row = tree.root.findAllByType('TaskRow').find(value => value.props.task.occurrenceHistory);
  assert.equal(row.props.disabled, true);
  await act(async () => {row.props.onCheckPress(); row.props.onLongPress();});
  assert.deepEqual(model.reopened, []); assert.deepEqual(model.completed, []);
  assert.equal(tree.root.findAllByType('Selection').length, 0);
  await act(async () => tree.unmount());
});
test('selection through pane menu never completes, including Select all across collapsed projects', async () => {
  const model = workspace(); let tree;
  await act(async () => {tree = create(React.createElement(model.Home, {nav: model.nav}));});
  await switchTo(tree, 'projects');
  await act(async () => tree.root.findByProps({accessibilityLabel: 'List menu'}).props.onPress());
  await act(async () => tree.root.findByProps({accessibilityLabel: 'Select tasks'}).props.onPress());
  await act(async () => tree.root.findByType('Selection').props.onSelectAll());
  assert.equal(tree.root.findByType('Selection').props.count, 3);
  assert.deepEqual(model.completed, []);
  await act(async () => tree.unmount());
});
test('account switch cancels the old workspace draft when returning from Settings', async () => {
  const model = workspace({apiToken: 'first-account'}); let tree;
  await act(async () => {tree = create(React.createElement(model.Home, {nav: model.nav, active: true}));});
  await act(async () => tree.root.findByType('Composer').props.onChangeText('Old account draft'));
  await act(async () => tree.update(React.createElement(model.Home, {nav: model.nav, active: false})));
  model.config.apiToken = 'second-account';
  await act(async () => tree.update(React.createElement(model.Home, {nav: model.nav, active: true})));
  assert.equal(tree.root.findByType('Composer').props.value, '');
  assert.equal(model.savedDrafts.length, 0);
  await act(async () => tree.unmount());
});
test('selecting an optimistic project before local commit preserves its draft and resolves the real local ID', async () => {
  const model = workspace(); let tree;
  await act(async () => {tree = create(React.createElement(model.Home, {nav: model.nav}));});
  await act(async () => tree.root.findByType('Sidebar').props.onCreateProject());
  await act(async () => tree.root.findByProps({accessibilityLabel: 'project name'}).props.onChangeText('Scratch project'));
  const save = tree.root.findAllByType('Pressable').find(node => node.findAllByType('Text').some(text => text.props.children === 'Save name'));
  await act(async () => {save.props.onPress();});
  const placeholder = tree.root.findByType('Sidebar').props.projects.find(project => project.name === 'Scratch project');
  await switchTo(tree, `project:${placeholder.id}`);
  await act(async () => tree.root.findByType('Composer').props.onChangeText('Draft while location saves'));
  await act(async () => tree.root.findByType('Composer').props.onSubmit());
  assert.equal(model.savedDrafts.length, 0);
  await act(async () => model.finishProject());
  assert.equal(tree.root.findByType('Sidebar').props.activeView, 'project:saved-local-project');
  assert.equal(tree.root.findByType('Composer').props.value, 'Draft while location saves');
  await act(async () => tree.root.findByType('Composer').props.onSubmit());
  assert.equal(model.savedDrafts[0].drafts[0].projectId, 'saved-local-project');
  await act(async () => tree.unmount());
});
const pressText = (tree, label) => tree.root.findAllByType('Pressable').find(node => node.findAllByType('Text').some(text => text.props.children === label));
test('failed container save stays retryable after closing its sheet and reuses the frozen request', async () => {
  const model = workspace(); let tree; const calls = [];
  model.service.createOfflineProject = async (name, options, request) => {
    request.ids ||= ['same-create-identity']; calls.push({name, request});
    if (calls.length === 1) {const error = new Error('lost local reply'); error.uncertainCommit = true; throw error;}
    const project = {id: 'retained-project', name}; model.updateData(data => ({...data, projects: [...data.projects, project]})); return project;
  };
  await act(async () => {tree = create(React.createElement(model.Home, {nav: model.nav}));});
  await act(async () => tree.root.findByType('Sidebar').props.onCreateProject());
  await act(async () => tree.root.findByProps({accessibilityLabel: 'project name'}).props.onChangeText('Retained project'));
  await act(async () => {pressText(tree, 'Save name').props.onPress();});
  await act(async () => tree.root.findByProps({accessibilityLabel: 'Close task actions'}).props.onPress());
  await switchTo(tree, 'device');
  await act(async () => tree.root.findByProps({accessibilityLabel: 'Retry container save'}).props.onPress());
  assert.equal(calls.length, 2); assert.equal(calls[0].request, calls[1].request);
  assert.deepEqual(calls.map(call => call.name), ['Retained project', 'Retained project']);
  assert.equal(tree.root.findAllByProps({accessibilityLabel: 'Retry container save'}).length, 0);
  await act(async () => tree.unmount());
});
test('failed Note and Device composer saves have global retries; manual local tasks remain on Device without note provenance', async () => {
  for (const view of ['note', 'device']) {
    const model = workspace({}, true); let tree; const calls = [];
    model.service.saveOfflineBatch = async (drafts, source, capturedAt, request) => {
      request.ids ||= [`identity-${view}`]; calls.push({request, source});
      if (calls.length === 1) throw new Error('local save failed');
      const task = {id: `saved-${view}`, content: drafts[0].content, project_id: drafts[0].projectId, source,
        batchId: request.ids[0], capturedAt, syncState: 'pending'};
      model.updateData(data => ({...data, tasks: [...data.tasks, task], allTasks: [...data.allTasks, task]})); return [task];
    };
    await act(async () => {tree = create(React.createElement(model.Home, {nav: model.nav}));});
    await switchTo(tree, view);
    await act(async () => tree.root.findByType('Composer').props.onChangeText(`Task from ${view}`));
    await act(async () => tree.root.findByType('Composer').props.onSubmit());
    await switchTo(tree, 'projects');
    await act(async () => tree.root.findByProps({accessibilityLabel: 'Retry new task save'}).props.onPress());
    assert.equal(calls.length, 2); assert.equal(calls[0].request, calls[1].request);
    await switchTo(tree, 'device');
    const saved = tree.root.findAllByType('TaskRow').find(row => row.props.task.id === `saved-${view}`);
    assert.ok(saved);
    if (view === 'device') {assert.equal(calls[1].source, null); assert.equal(saved.props.onOpenNote, undefined); assert.match(JSON.stringify(tree.toJSON()), /Created on this device/);}
    await act(async () => tree.unmount());
  }
});
test('Keep tasks requires an explicit surviving writable project and passes its destination with the verified scope', async () => {
  const model = workspace(); let tree; const deletes = [];
  model.updateData(data => ({...data, projects: [...data.projects, {id: 'child', parent_id: 'p', name: 'Child'},
    {id: 'viewer', name: 'Read only', can_edit: false}, {id: 'q', name: 'Survivor'}]}));
  model.service.inspectOfflineContainer = async () => ({canKeep: true, allowed: true, count: 2, scopeToken: 'verified-scope'});
  model.service.deleteOfflineContainer = async (kind, id, options, request) => {deletes.push({kind, id, options, request});};
  await act(async () => {tree = create(React.createElement(model.Home, {nav: model.nav}));});
  await switchTo(tree, 'project:p');
  await act(async () => tree.root.findByProps({accessibilityLabel: 'List menu'}).props.onPress());
  await act(async () => pressText(tree, 'Rename or delete project').props.onPress());
  const picker = tree.root.findByType('ProjectPicker');
  assert.equal(picker.props.requireExplicit, true); assert.equal(picker.props.selectedId, null);
  assert.deepEqual(picker.props.projects.map(project => project.id), ['i', 'q']);
  assert.equal(pressText(tree, 'Delete container; keep tasks').props.disabled, true);
  await act(async () => picker.props.onChange('q'));
  await act(async () => pressText(tree, 'Delete container; keep tasks').props.onPress());
  assert.equal(tree.root.findAllByType('Text').some(node => String(node.props.children).includes('2 verified tasks in Survivor')), true);
  await act(async () => pressText(tree, 'Confirm deletion').props.onPress());
  assert.equal(deletes[0].options.destinationProjectId, 'q'); assert.equal(deletes[0].options.confirmCount, 2);
  assert.equal(deletes[0].options.scopeToken, 'verified-scope'); assert.equal(deletes[0].options.mode, 'keep');
  await act(async () => tree.unmount());
});
test('Note and Device retain a protected recurring history row beside its active next occurrence across owned ID aliases', async () => {
  const history = {id: 'one', project_id: 'p', content: 'Prior recurring occurrence', completed: true, occurrenceHistory: true,
    completed_at: '2026-10-04', due: {date: '2026-10-04', is_recurring: true}};
  const model = workspace({}, true, [history]); let tree;
  model.updateData(data => {
    const next = task => task.id === 'one' && !task.completed ? {...task, id: 'remote:one', remoteId: 'one', due: {date: '2026-10-06', is_recurring: true}} : task;
    return {...data, tasks: data.tasks.map(next), allTasks: data.allTasks.map(next)};
  });
  await act(async () => {tree = create(React.createElement(model.Home, {nav: model.nav}));});
  for (const view of ['note', 'device']) {
    await switchTo(tree, view);
    const rows = tree.root.findAllByType('TaskRow');
    assert.ok(rows.some(row => row.props.task.id === 'remote:one' && !row.props.task.completed));
    const occurrence = rows.find(row => row.props.task.occurrenceHistory);
    assert.ok(occurrence); assert.equal(occurrence.props.disabled, true);
    await act(async () => occurrence.props.onCheckPress());
    assert.deepEqual(model.reopened, []); assert.deepEqual(model.completed, []);
  }
  await act(async () => tree.unmount());
});
