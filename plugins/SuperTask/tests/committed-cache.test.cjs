const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const model = require('../src/offline/model');
const locations = require('../src/offline/locations');
const {projectCommittedSnapshot, shareSnapshot} = require('../src/cache/committedSnapshot.cjs');
let seq = 0; const ids = () => `cache-test-${++seq}`;
const task = (id, patch = {}) => ({id, content: id, project_id: 'p', section_id: null, order_key: 'a0', ...patch});
function state() {return model.replaceRemote(model.emptyStore('account', 'device'), [task('active'), task('recurring', {due: {date: '2026-10-05', is_recurring: true}})], [{id: 'p', name: 'Project'}], 1, [{id: 's', project_id: 'p', name: 'Section'}]);}
function deferred() {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};}
function load(service) {
  const filename = path.resolve(__dirname, '../src/cache/taskCache.js'), mod = new Module(filename, module);
  mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const normal = mod.require.bind(mod);
  mod.require = name => name === '../offline/service' ? service : name === '../utils/debug' ? {log() {}} : normal(name);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, allowJs: true}}).outputText, filename);
  return mod.exports;
}
test('committed projection preserves all completed/history suppression, aliases and queue metadata with one task projection', () => {
  let s = state(); s = model.rememberTask(s, task('missing')); model.ownTask(s, 'missing');
  s = model.replaceRemote(s, s.remote.filter(t => t.id !== 'missing'), s.projects, 2, s.sections);
  s = model.rememberTask(s, task('deleted')); s = model.deleteTask(s, 'deleted', ids);
  s.completedRemote = [task('history', {checked: false}), task('recurring', {completed_at: '2026-10-04'})];
  const created = locations.createProject(s, 'Local project', ids); s = created.next;
  s = model.addCollection(s, created.project.id, 'Local section', ids).next;
  s.outbox[0].attempts = 2; s.outbox[0].state = 'attention'; s.outbox[0].error = 'Synthetic attention';
  const expectedCompleted = model.completedView(s);
  const original = model.privateTasks; let calls = 0;
  model.privateTasks = value => {calls++; return original(value);};
  let projected; try {projected = projectCommittedSnapshot(s, {warning: 'Recovery warning', otherAccountStores: 2});} finally {model.privateTasks = original;}
  assert.equal(calls, 1); assert.deepEqual(projected.completedTasks, expectedCompleted);
  assert.deepEqual(projected.tasks.map(t => t.id), ['active', 'recurring']);
  assert.equal(projected.allTasks.some(t => t.remoteMissing), true); assert.equal(projected.allTasks.some(t => t.deleted), true);
  assert.equal(projected.projects.some(p => p.id === created.project.id), true);
  assert.equal(projected.pendingTaskCount, 1); assert.equal(projected.pendingProjectCount, 1); assert.equal(projected.pendingCollectionCount, 1);
  assert.equal(projected.pendingChanges[0].attempts, 2); assert.equal(projected.errorCount, 1); assert.equal(projected.warning, 'Recovery warning');
});
test('structural sharing keeps unchanged rows stable through single-row edits and reorder', () => {
  const before = projectCommittedSnapshot(state());
  const s = state(); s.remote[0].content = 'Edited'; s.revision++;
  const edited = shareSnapshot(before, projectCommittedSnapshot(s));
  assert.equal(edited.changed, true); assert.equal(edited.snapshot.tasks[1], before.tasks[1]);
  assert.notEqual(edited.snapshot.tasks[0], before.tasks[0]); assert.equal(edited.snapshot.projects, before.projects);
  const reordered = {...edited.snapshot, tasks: [...edited.snapshot.tasks].reverse()};
  const shared = shareSnapshot(edited.snapshot, reordered);
  assert.equal(shared.snapshot.tasks[0], edited.snapshot.tasks[1]); assert.equal(shared.snapshot.tasks[1], edited.snapshot.tasks[0]);
});
test('cache synchronously exposes complete committed history, deduplicates no-op revisions and publishes status changes', () => {
  let emit; const cache = load({subscribeOffline: listener => {emit = listener;}, offlineData: async () => null});
  const events = []; cache.subscribeCache(data => events.push(data));
  const s = state(); s.completedRemote = [task('history')]; emit(s);
  const initial = cache.getCachedWorkspace(); assert.equal(initial.completedTasks.length, 1);
  assert.equal(cache.getCachedWorkspace('another-account'), null);
  emit(JSON.parse(JSON.stringify(s))); assert.equal(events.length, 1); assert.equal(cache.getCache(), initial);
  const noOp = {...s, revision: s.revision + 1}; emit(noOp);
  assert.equal(events.length, 1); assert.equal(cache.getCache().revision, noOp.revision); assert.equal(cache.getCache().tasks, initial.tasks);
  emit({...noOp, revision: noOp.revision + 1, syncError: 'Synthetic offline status'});
  assert.equal(events.length, 2); assert.equal(cache.getCache().tasks, initial.tasks);
});
test('hydration is deduplicated and cannot overwrite a newer same-account committed notification', async () => {
  let emit, reads = 0; const older = deferred(), cache = load({subscribeOffline: listener => {emit = listener;}, offlineData: () => {reads++; return older.promise;}});
  const first = cache.initTaskCache(); assert.equal(cache.initTaskCache(), first); await Promise.resolve(); assert.equal(reads, 1);
  const s = state(); s.revision = 7; s.remote[0].content = 'Newer committed title'; emit(s);
  older.resolve(projectCommittedSnapshot(state())); await first;
  assert.equal(cache.getCachedWorkspace().tasks[0].content, 'Newer committed title');
  assert.equal(cache.getCachedWorkspace().revision, 7);
});
test('cache invalidation immediately removes old-account history and rejects stale hydration', async () => {
  let emit, reads = 0; const next = deferred();
  const cache = load({subscribeOffline: listener => {emit = listener;}, offlineData: () => {reads++; return next.promise;}});
  const old = state(); old.completedRemote = [task('old history')]; emit(old);
  assert.equal(cache.getCachedWorkspace().completedTasks.length, 1);
  cache.invalidateCache(); assert.equal(cache.getCachedWorkspace(), null);
  const fresh = {...state(), accountKey: 'new-account', completedRemote: [task('new history')]};
  emit(fresh); next.resolve(projectCommittedSnapshot(old)); await cache.initTaskCache();
  assert.equal(cache.getCachedWorkspace().accountKey, 'new-account'); assert.equal(cache.getCachedWorkspace().completedTasks[0].id, 'new history');
  assert.equal(reads, 1);
});
test('older sync read cannot repaint over a newer committed revision and preserves latest status', async () => {
  let emit; const response = deferred();
  const cache = load({subscribeOffline: listener => {emit = listener;}, syncOffline: () => response.promise, offlineData: async () => null});
  const syncing = cache.fetchTaskData(); const s = state(); s.revision = 4; s.syncError = 'Attention'; emit(s);
  response.resolve(projectCommittedSnapshot(state())); await syncing;
  assert.equal(cache.getCache().revision, 4); assert.equal(cache.getCache().syncError, 'Attention');
});
test('complete hydration needs no separate history read; legacy fallback never claims completeness early', async () => {
  let historyReads = 0;
  const snapshot = projectCommittedSnapshot(state());
  const complete = load({subscribeOffline() {}, offlineData: async () => snapshot, completedData: async () => {historyReads++; return [];}});
  await complete.initTaskCache(); assert.equal(historyReads, 0); assert.equal(complete.getCachedWorkspace(), snapshot);
  const history = deferred(), legacy = load({subscribeOffline() {}, offlineData: async () => ({tasks: []}), completedData: () => {historyReads++; return history.promise;}});
  const loading = legacy.initTaskCache(); assert.equal(legacy.getCachedWorkspace(), null); history.resolve([task('history')]); await loading;
  assert.equal(historyReads, 1); assert.equal(legacy.getCachedWorkspace().completedTasks.length, 1);
});
