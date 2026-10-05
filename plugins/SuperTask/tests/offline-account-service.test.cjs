const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const model = require('../src/offline/model');
function deferred() {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};}
function harness() {
  const h = {token: 'synthetic-account-one', disks: new Map(), commits: [], idCalls: 0, idHook: null, commitHook: null};
  let seq = 0;
  const storage = {
    initialize: async (_dir, token) => JSON.stringify({accountKey: `store-${token}`, deviceId: 'device'}),
    read: async key => JSON.stringify({exists: h.disks.has(key), main: h.disks.get(key) || null}),
    newIds: async count => {h.idCalls++; if (h.idHook) {await h.idHook();} return JSON.stringify(Array.from({length: count}, () => `account-test-${++seq}`));},
    commit: async (key, next, previous) => {
      if (h.disks.has(key)) {assert.equal(previous, h.disks.get(key));}
      h.disks.set(key, next); h.commits.push(key); if (h.commitHook) {await h.commitHook();}
    },
  };
  const mocks = {'react-native': {NativeModules: {TaskStorage: storage}}, 'sn-plugin-lib': {PluginManager: {getPluginDirPath: async () => '/private/synthetic'}},
    '../utils/config': {loadConfig: async () => ({apiToken: h.token}), getCachedConfig: () => ({apiToken: h.token})},
    '../utils/permissions': {ensurePermissionGroup: async () => false}, '../utils/debug': {log() {}}};
  const filename = path.resolve(__dirname, '../src/offline/service.js'), mod = new Module(filename, module);
  mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const normal = mod.require.bind(mod); mod.require = name => Object.hasOwn(mocks, name) ? mocks[name] : normal(name);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, allowJs: true}}).outputText, filename);
  h.service = mod.exports; return h;
}
test('capture binds account before identity allocation and rejects a switch before commit', async () => {
  const h = harness(), entered = deferred(), release = deferred(), request = {};
  h.idHook = async () => {entered.resolve(); await release.promise;};
  const saving = h.service.saveOfflineBatch([{content: 'Synthetic capture'}], null, Date.now(), request);
  const rejected = assert.rejects(saving, error => error.code === 'ACCOUNT_CHANGED');
  await entered.promise; assert.equal(request.accountKey, 'store-synthetic-account-one');
  h.token = 'synthetic-account-two'; release.resolve(); await rejected;
  assert.equal(h.commits.length, 0);
});
test('postcommit switch rejects UI result and uncertain request cannot retry into another account', async () => {
  const h = harness(), request = {};
  h.commitHook = async () => {h.token = 'synthetic-account-two';};
  await assert.rejects(h.service.saveOfflineBatch([{content: 'Saved in original account'}], null, 1, request), error => error.code === 'ACCOUNT_CHANGED');
  assert.equal(h.commits.length, 1); const idCalls = h.idCalls;
  h.commitHook = null;
  await assert.rejects(h.service.saveOfflineBatch([{content: 'Saved in original account'}], null, 1, request), error => error.code === 'ACCOUNT_CHANGED');
  assert.equal(h.commits.length, 1); assert.equal(h.idCalls, idCalls);
  h.token = 'synthetic-account-one';
  const tasks = await h.service.saveOfflineBatch([{content: 'Saved in original account'}], null, 1, request);
  assert.equal(tasks.length, 1); assert.equal(h.commits.length, 1);
});
test('bulk and location mutation requests also retain original account binding on retry', async () => {
  const h = harness(), request = {};
  await h.service.createOfflineProject('Synthetic project', {}, request);
  h.token = 'synthetic-account-two';
  await assert.rejects(h.service.createOfflineProject('Synthetic project', {}, request), error => error.code === 'ACCOUNT_CHANGED');
  assert.equal(h.commits.length, 1);
  h.token = 'synthetic-account-one';
  const task = (await h.service.saveOfflineBatch([{content: 'Synthetic task'}]))[0], bulkRequest = {};
  await h.service.mutateOfflineTasks([task.id], {kind: 'edit', patch: {priority: 4}}, bulkRequest);
  h.token = 'synthetic-account-two';
  await assert.rejects(h.service.mutateOfflineTasks([task.id], {kind: 'edit', patch: {priority: 4}}, bulkRequest), error => error.code === 'ACCOUNT_CHANGED');
  assert.equal(h.commits.length, 3);
});
test('legacy editor/completion/delete mutations reject a switch during native identity allocation', async () => {
  for (const method of ['editOfflineTask', 'completeOffline', 'deleteOfflineTask']) {
    const h = harness(), task = (await h.service.saveOfflineBatch([{content: 'Original title'}]))[0];
    const entered = deferred(), release = deferred();
    h.idHook = async () => {entered.resolve(); await release.promise;};
    const saving = h.service[method](task.id, method === 'editOfflineTask' ? {content: 'Changed'} : true);
    const rejected = assert.rejects(saving, error => error.code === 'ACCOUNT_CHANGED');
    await entered.promise; h.token = 'synthetic-account-two'; release.resolve(); await rejected;
    assert.equal(h.commits.length, 1);
  }
});
test('pending recurring metadata reports attempted attention as sent, never as an unsent undo', async () => {
  const h = harness(); let state = model.emptyStore(`store-${h.token}`, 'device'), sequence = 0;
  const ids = () => `occurrence-${++sequence}`;
  state = model.addBatch(state, [{content: 'Recurring', due: {date: '2026-10-05', is_recurring: true, string: 'every day'}}], null, ids).next;
  const create = state.outbox[0]; state = model.markSending(state, [create]);
  state = model.acknowledge(state, [create], {sync_status: {[create.uuid]: 'ok'}, temp_id_mapping: {[create.tempId]: 'remote-recurring'}});
  state = model.setCompleted(state, create.localId, true, ids); state = model.markSending(state, model.readyOperations(state));
  state.outbox[0].state = 'attention'; state.outbox[0].occurrenceKey = 'synthetic-occurrence';
  h.disks.set(state.accountKey, JSON.stringify(state));
  const data = await h.service.offlineData();
  assert.equal(data.pendingChanges[0].attempts, 1); assert.equal(data.pendingChanges[0].occurrenceKey, 'synthetic-occurrence');
});
