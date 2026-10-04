const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const m = require('../src/offline/model');
const {createStore} = require('../src/offline/store');
const {createSyncWorker} = require('../src/offline/sync');
const {createTransport} = require('../src/offline/transport');
let sequence = 0;
const ids = () => `missing-test-${++sequence}`;
const remote = (patch = {}) => ({id: 'r', content: 'Original', description: '', project_id: 'p', section_id: null,
  labels: [], priority: 1, checked: false, due: null, ...patch});
const initial = () => m.replaceRemote(m.emptyStore('account', 'device'), [remote()], [{id: 'p', name: 'Project'}], 1, []);
function acknowledged() {
  let state = m.editTask(initial(), 'r', {content: 'Accepted'}, ids);
  state = m.markSending(state, state.outbox);
  state = m.acknowledge(state, state.outbox, {sync_status: {[state.outbox[0].uuid]: 'ok'}}, 2);
  return m.reconcileAcknowledged(state, 'remote:r', {status: 'found', task: remote({content: 'Accepted'})});
}
const missing = () => {const state = acknowledged(); return m.replaceRemote(state, [], state.projects, 3, []);};
function diskFor(state) {
  return {main: JSON.stringify(state), async read() {return {exists: true, main: this.main};},
    async commit(next, previous) {assert.equal(previous, this.main); this.main = next;}};
}

test('an acknowledged task disappearing from a complete active snapshot is hidden, not deleted or completed', async () => {
  const state = acknowledged(), before = structuredClone(state.tasks['remote:r']);
  const disk = diskFor(state), store = createStore(disk, 'account', 'device');
  await createSyncWorker(store, {userId: async () => 'user',
    fetchSnapshot: async () => ({tasks: [], projects: state.projects, sections: []})}).sync();
  const restarted = await createStore(disk, 'account', 'device').load();
  const retained = m.cachedView(restarted, 'r');
  assert.equal(retained.remoteMissing, true);
  assert.equal(retained.content, before.content);
  assert.deepEqual(retained.baseRemote, before.baseRemote);
  assert.equal(retained.completed, false);
  assert.equal(retained.deleted, false);
  assert.equal(Object.keys(restarted.tasks).length, 1);
  assert.deepEqual(m.mergedTasks(restarted), []);
  assert.deepEqual(m.snapshot(restarted).tasks, []);
  assert.deepEqual(m.completedView(restarted), []);
});

test('snapshot reappearance and a positive per-task read clear missing state and refresh cached data', () => {
  for (const refresh of [state => m.replaceRemote(state, [remote({content: 'Returned'})], state.projects, 4, []),
    state => m.rememberTask(state, remote({content: 'Returned'}))]) {
    const next = refresh(missing());
    assert.equal(m.cachedView(next, 'r').remoteMissing, false);
    assert.equal(m.mergedTasks(next)[0].content, 'Returned');
    assert.equal(next.tasks['remote:r'].baseRemote.content, 'Returned');
  }
});

test('never-sent creates, pending edits and attention changes survive absence with visible desired work', () => {
  let state = m.editTask(initial(), 'r', {content: 'Keep desired edit'}, ids);
  state = m.addBatch(state, [{content: 'New offline', project_id: 'p'}], null, ids).next;
  state = m.replaceRemote(state, [], state.projects, 3, []);
  assert.deepEqual(m.mergedTasks(state).map(task => task.content), ['Keep desired edit', 'New offline']);
  assert.ok(m.mergedTasks(state).every(task => !task.remoteMissing && task.syncState === 'pending'));
  const edited = state.outbox.find(op => op.kind === 'update');
  state = m.preflight(state, edited.uuid, {status: 'unavailable'});
  assert.equal(m.mergedTasks(state).find(task => task.remoteId === 'r').syncState, 'attention');
  assert.equal(state.tasks['remote:r'].deleted, undefined);
});

test('editing or completing a missing cached task reveals the queued desired state again', () => {
  for (const mutate of [state => m.editTask(state, 'r', {content: 'Recover edit'}, ids),
    state => {state.projects.push({id: 'q', name: 'Move here'}); return m.editTask(state, 'r', {project_id: 'q'}, ids);},
    state => m.setCompleted(state, 'r', true, ids)]) {
    const next = mutate(missing());
    assert.ok(next.outbox.length > 0);
    assert.equal(m.cachedView(next, 'r').remoteMissing, false);
    assert.equal(m.mergedTasks(next).length, 1);
    assert.equal(m.snapshot(next).tasks.length, 1);
  }
});

test('create/update acknowledgement propagation and a waiting recurring occurrence are not hidden', () => {
  let created = m.addBatch(initial(), [{content: 'Created', project_id: 'p'}], null, ids).next;
  const create = created.outbox[0]; created = m.markSending(created, [create]);
  created = m.acknowledge(created, created.outbox, {sync_status: {[create.uuid]: 'ok'}, temp_id_mapping: {[create.tempId]: 'new'}});
  created = m.replaceRemote(created, [], created.projects, 4, []);
  assert.equal(m.mergedTasks(created).find(task => task.remoteId === 'new').remoteMissing, false);
  created.tasks[create.localId].ackPendingRefresh = false;
  created = m.replaceRemote(created, [], created.projects, 5, []);
  assert.equal(created.tasks[create.localId].remoteMissing, false, 'unresolved creation mapping guard independently protects visibility');
  created = m.replaceRemote(created, [remote({id: 'new', content: 'Created', description: 'Server default'})], created.projects, 6, []);
  assert.equal(created.tasks[create.localId].acknowledgedCreate, false);
  assert.equal(created.tasks[create.localId].baseRemote.description, 'Server default');
  created = m.replaceRemote(created, [], created.projects, 7, []);
  assert.equal(created.tasks[create.localId].remoteMissing, true, 'observed creation no longer stays visible forever after external removal');
  let updated = m.editTask(initial(), 'r', {content: 'Accepted'}, ids);
  updated = m.markSending(updated, updated.outbox);
  updated = m.acknowledge(updated, updated.outbox, {sync_status: {[updated.outbox[0].uuid]: 'ok'}});
  updated = m.replaceRemote(updated, [], updated.projects, 4, []);
  assert.equal(m.mergedTasks(updated)[0].content, 'Accepted');
  assert.equal(updated.tasks['remote:r'].remoteMissing, false);
  const due = {date: '2026-10-04', is_recurring: true, string: 'every day'};
  let recurring = m.rememberTask(initial(), remote({due}));
  recurring = m.setCompleted(recurring, 'r', true, ids);
  recurring = m.markSending(recurring, recurring.outbox);
  recurring = m.acknowledge(recurring, recurring.outbox, {sync_status: {[recurring.outbox[0].uuid]: 'ok'}});
  recurring = m.replaceRemote(recurring, [], recurring.projects, 4, []);
  assert.equal(recurring.tasks['remote:r'].awaitingRecurrence, true);
  assert.equal(recurring.tasks['remote:r'].remoteMissing, false);
  assert.deepEqual(m.completedView(recurring)[0].due, due);
  recurring = m.rememberTask(recurring, remote({due}));
  assert.equal(recurring.tasks['remote:r'].completed, true, 'stale per-task reads keep occurrence pending');
  recurring = m.replaceRemote(recurring, [remote({due: {...due, date: '2026-10-05'}})], recurring.projects, 5, []);
  assert.equal(m.mergedTasks(recurring)[0].completed, false);
});

test('known completed history survives missing active snapshots and can queue a reopen', () => {
  let state = m.rememberTask(acknowledged(), remote({content: 'Accepted', completed: true}));
  state = m.replaceRemote(state, [], state.projects, 4, []);
  assert.equal(state.tasks['remote:r'].remoteMissing, true);
  assert.equal(m.completedView(state)[0].completed, true);
  state = m.setCompleted(state, 'r', false, ids);
  assert.equal(state.outbox[0].kind, 'reopen');
  assert.equal(m.mergedTasks(state)[0].remoteMissing, false);
});

test('explicit completed history resolves a missing owned task and provides the completed baseline for reopening', async () => {
  const service = loadService(missing());
  await service.rememberCompleted([remote({content: 'Completed outside', checked: false, completed_at: '2026-10-04T12:00:00Z'})]);
  const done = await service.completedData();
  assert.equal(done.length, 1);
  assert.equal(done[0].content, 'Completed outside');
  assert.equal(done[0].completed, true);
  assert.equal(done[0].baseRemote.completed, true);
  const state = m.rememberCompleted(missing(), [remote({content: 'Completed outside'})]);
  const reopened = m.setCompleted(state, 'r', false, ids);
  assert.equal(reopened.outbox[0].kind, 'reopen');
  const verified = m.preflight(reopened, reopened.outbox[0].uuid, {status: 'found', task: remote({content: 'Completed outside', completed: true})});
  assert.equal(verified.outbox.length, 1);
  assert.deepEqual(verified.syncNotices, []);
});

test('reopened history becomes active without retaining stale completion aliases or occurrence history', () => {
  let state = m.rememberCompleted(missing(), [remote({completed_at: '2026-10-04T12:00:00Z'})]);
  assert.equal(m.cachedView(state, 'r').is_completed, true);
  assert.equal(m.cachedView(state, 'r').occurrenceHistory, true);
  state = m.setCompleted(state, 'r', false, ids);
  state = m.markSending(state, state.outbox);
  state = m.acknowledge(state, state.outbox, {sync_status: {[state.outbox[0].uuid]: 'ok'}});
  const active = remote(); delete active.checked;
  state = m.rememberTask(state, active);
  const view = m.cachedView(state, 'r');
  assert.equal(view.completed, false);
  assert.equal(view.is_completed, false);
  assert.equal(view.checked, false);
  assert.equal(view.occurrenceHistory, false);
  assert.equal(view.baseRemote.completed, false);
  assert.deepEqual(m.completedView(state), []);
});

test('completed history never closes an active recurring series, pending edit or unrefreshed acknowledgement', () => {
  const due = {date: '2026-10-05', is_recurring: true, string: 'every day'};
  let active = m.rememberTask(acknowledged(), remote({content: 'Accepted', due}));
  active = m.rememberCompleted(active, [remote({due: {...due, date: '2026-10-04'}})]);
  assert.equal(active.tasks['remote:r'].completed, false);
  assert.deepEqual(active.tasks['remote:r'].due, due);
  assert.deepEqual(m.completedView(active), []);
  let queued = m.editTask(missing(), 'r', {content: 'Desired'}, ids);
  queued = m.rememberCompleted(queued, [remote({content: 'History'})]);
  assert.equal(queued.tasks['remote:r'].content, 'Desired');
  assert.equal(queued.tasks['remote:r'].completed, false);
  let ack = m.editTask(initial(), 'r', {content: 'Accepted'}, ids);
  ack = m.markSending(ack, ack.outbox);
  ack = m.acknowledge(ack, ack.outbox, {sync_status: {[ack.outbox[0].uuid]: 'ok'}});
  ack = m.replaceRemote(ack, [], ack.projects, 4, []);
  ack = m.rememberCompleted(ack, [remote({content: 'History'})]);
  assert.equal(ack.tasks['remote:r'].content, 'Accepted');
  assert.equal(ack.tasks['remote:r'].ackPendingRefresh, true);
  assert.equal(ack.tasks['remote:r'].completed, false);
});

test('an incomplete transport snapshot cannot mark or hide a cached acknowledged task', async () => {
  const state = acknowledged(), disk = diskFor(state), store = createStore(disk, 'account', 'device');
  const api = createTransport('test-only', async (_url, options) => {
    const resources = JSON.parse(new URLSearchParams(options.body).get('resource_types'));
    return {ok: true, json: async () => resources.includes('user') ? {user: {id: 'user'}} :
      {full_sync: false, items: [], projects: [], sections: []}};
  }, async () => true);
  await assert.rejects(createSyncWorker(store, api).sync(), /incomplete/);
  const next = await store.load();
  assert.equal(m.mergedTasks(next)[0].content, 'Accepted');
  assert.equal(next.tasks['remote:r'].remoteMissing, false);
  assert.equal(next.lastSync, state.lastSync);
});

function loadService(state) {
  const filename = path.resolve(__dirname, '../src/offline/service.js'), disk = diskFor(state);
  const config = {apiToken: 'test-only'};
  const mocks = {'react-native': {NativeModules: {TaskStorage: {
    initialize: async () => JSON.stringify({accountKey: 'account', deviceId: 'device'}),
    read: async () => JSON.stringify(await disk.read()), commit: (...args) => disk.commit(args[1], args[2]),
  }}}, 'sn-plugin-lib': {PluginManager: {getPluginDirPath: async () => '/private'}},
  '../utils/config': {loadConfig: async () => config, getCachedConfig: () => config},
  '../utils/permissions': {ensurePermissionGroup: async () => true}, '../utils/debug': {log() {}}};
  return loadModule(filename, mocks);
}
function loadModule(filename, mocks) {
  const loaded = new Module(filename, module); loaded.filename = filename; loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const realRequire = loaded.require.bind(loaded);
  loaded.require = name => Object.hasOwn(mocks, name) ? mocks[name] : realRequire(name);
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, allowJs: true},
  }).outputText, filename);
  return loaded.exports;
}

test('real service exposes missing records and tombstones only in its private registry view', async () => {
  let state = missing();
  state = m.addBatch(state, [{content: 'New offline', project_id: 'p'}], null, ids).next;
  state = m.rememberTask(state, remote({id: 'deleted', content: 'Delete me'}));
  state = m.deleteTask(state, 'deleted', ids);
  const service = loadService(state), data = await service.offlineData();
  assert.deepEqual(data.tasks.map(task => task.content), ['New offline']);
  assert.equal(data.allTasks.find(task => task.remoteId === 'r').remoteMissing, true);
  assert.equal(data.allTasks.find(task => task.remoteId === 'deleted').deleted, true);
  assert.equal((await service.cachedTask('r')).content, 'Accepted');
  assert.equal(await service.cachedTask('deleted'), null);
  assert.deepEqual(m.snapshot(state).tasks.map(task => task.content), ['New offline']);
});

test('cache subscription uses the same private missing/tombstone projection as service hydration', () => {
  let onChange;
  const cache = loadModule(path.resolve(__dirname, '../src/cache/taskCache.js'), {
    '../offline/service': {subscribeOffline(listener) {onChange = listener;}}, '../utils/debug': {log() {}},
  });
  let state = missing();
  state = m.rememberTask(state, remote({id: 'deleted', content: 'Delete me'}));
  state = m.deleteTask(state, 'deleted', ids);
  onChange(state);
  const data = cache.getCache();
  assert.deepEqual(data.tasks, []);
  assert.equal(data.allTasks.find(task => task.remoteId === 'r').remoteMissing, true);
  assert.equal(data.allTasks.find(task => task.remoteId === 'deleted').deleted, true);
  assert.equal(data.pendingCount, 1);
});
