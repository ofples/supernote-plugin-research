const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../src/offline/model');
const {createStore} = require('../src/offline/store');
const {createSyncWorker} = require('../src/offline/sync');
const {createTransport} = require('../src/offline/transport');
let sequence = 0;
const ids = () => `uuid-${++sequence}`;
const task = (patch = {}) => ({id: 'r', content: 'Remote', description: 'Details', project_id: 'p', section_id: null,
  labels: ['b', 'a'], priority: 2, due: {date: '2026-10-04', is_recurring: false}, checked: false, ...patch});
function cached(t = task()) {return m.replaceRemote(m.emptyStore('a', 'd'), [t], [{id: 'p', name: 'Project'}, {id: 'q', name: 'Other'}], 1, [{id: 's', project_id: 'p', name: 'Section'}]);}
function adapter(state) {return {main: state ? JSON.stringify(state) : null, backup: null,
  async read() {return {exists: !!this.main, main: this.main, backup: this.backup};},
  async commit(next, previous) {if (this.main !== null) assert.equal(previous, this.main, 'exact native CAS payload'); this.backup = previous; this.main = next;}};}
const storeFor = disk => createStore(disk, 'a', 'd');
function accepted(s, ops = m.readyOperations(s), mapping = {}) {
  s = m.markSending(s, ops);
  const sending = s.outbox.filter(o => ops.some(op => op.uuid === o.uuid));
  return m.acknowledge(s, sending, {sync_status: Object.fromEntries(ops.map(op => [op.uuid, 'ok'])), temp_id_mapping: mapping}, 5);
}

test('schema 1 migration preserves exact disk previous bytes, old frozen commands and backup', async () => {
  const old = cached(); old.schema = 1; delete old.collections; delete old.syncNotices; delete old.conflictArchive;
  const raw = JSON.stringify(old, null, 2), disk = adapter(); disk.main = raw;
  const store = storeFor(disk); assert.equal((await store.load()).schema, 2);
  assert.equal(disk.main, raw);
  await store.transaction(s => m.editTask(s, 'r', {content: 'Changed'}, ids));
  assert.equal(disk.backup, raw); assert.equal(JSON.parse(disk.main).revision, old.revision + 1);
  assert.throws(() => m.validateStore({...old, schema: 3}, 'a', 'd'), /Unsupported/);
});

test('all cached tasks including completed history accept partial edits without losing recurrence/source', () => {
  const recurring = task({due: {date: '2026-10-04', is_recurring: true, string: 'every day', timezone: 'Asia/Kolkata', lang: 'en'}, source: {filePath: '/note', pageNum: 3}});
  let s = m.editTask(cached(recurring), 'r', {content: 'Rename', priority: 4, labels: ['x']}, ids);
  assert.deepEqual(s.tasks['remote:r'].due, recurring.due); assert.deepEqual(s.tasks['remote:r'].source, recurring.source);
  assert.deepEqual(m.commandFor(s, s.outbox[0]).args, {id: 'r', content: 'Rename', priority: 4, labels: ['x']});
  s = m.editTask(s, 'r', {due: null}, ids);
  assert.equal(m.commandFor(s, s.outbox[0]).args.due, null);
  let done = cached(); done.remote = []; done.completedRemote = [task({completed: true, checked: true})];
  done = m.editTask(done, 'r', {description: 'Edited history'}, ids);
  assert.equal(done.tasks['remote:r'].completed, true);
});

test('moves clear incompatible sections and freeze exactly one destination', () => {
  let s = m.editTask(cached(task({section_id: 's'})), 'r', {project_id: 'q'}, ids);
  assert.equal(s.tasks['remote:r'].section_id, null);
  assert.deepEqual(m.commandFor(s, s.outbox[0]).args, {id: 'r', project_id: 'q'});
  assert.throws(() => m.editTask(s, 'r', {section_id: 's'}, ids), /collection is unavailable/);
});

test('unsent create edits fold, while uncertain create edits/delete wait behind its immutable UUID', () => {
  let s = m.addBatch(cached(), [{content: 'New', project_id: 'p'}], null, ids).next;
  const create = s.outbox[0], id = create.localId;
  s = m.editTask(s, id, {content: 'Folded', due: null}, ids); assert.equal(s.outbox.length, 1);
  s = m.markSending(s, [create]); const frozen = m.commandFor(s, s.outbox[0]);
  s = m.editTask(s, id, {content: 'Later'}, ids); assert.equal(s.outbox.length, 2);
  assert.deepEqual(m.commandFor(s, s.outbox[0]), frozen);
  s = m.deleteTask(s, id, ids); assert.deepEqual(s.outbox.map(o => o.kind), ['create', 'delete']);
  assert.deepEqual(m.readyOperations(s).map(o => o.kind), ['create']);
  s = m.acknowledge(s, [create], {sync_status: {[create.uuid]: 'ok'}, temp_id_mapping: {[create.tempId]: 'new-remote'}});
  assert.deepEqual(m.readyOperations(s).map(o => o.kind), ['delete']);
  assert.equal(m.mergedTasks(s).some(t => t.id === id), false);
});

test('delete tombstones survive restart, cancel unsent create locally, and cannot be resurrected by stale snapshots', async () => {
  let s = m.deleteTask(cached(), 'r', ids);
  const disk = adapter(s), restored = await storeFor(disk).load();
  assert.equal(restored.tasks['remote:r'].deleted, true); assert.equal(m.mergedTasks(restored).length, 0);
  s = accepted(restored); assert.equal(s.tasks['remote:r'].deleteAcknowledged, true);
  s = m.replaceRemote(s, [task()], s.projects); assert.equal(m.mergedTasks(s).length, 0);
  let fresh = m.addBatch(cached(), [{content: 'Never sent'}], null, ids).next;
  fresh = m.deleteTask(fresh, fresh.outbox[0].localId, ids); assert.equal(fresh.outbox.length, 0);
});

test('collection mapping blocks dependent create and move until individual acknowledgement', () => {
  let result = m.addCollection(cached(), 'p', 'New collection', ids), s = result.next;
  const section = result.collection, createSection = s.outbox[0];
  s = m.addBatch(s, [{content: 'Dependent', project_id: 'p', section_id: section.id}], null, ids).next;
  s = m.editTask(s, 'r', {section_id: section.id}, ids);
  assert.deepEqual(m.readyOperations(s).map(o => o.kind), ['collection_create']);
  assert.equal(m.mergedSections(s).find(c => c.id === section.id).syncState, 'pending');
  s = accepted(s, [createSection], {[createSection.tempId]: 'real-section'});
  assert.deepEqual(m.readyOperations(s).map(o => o.kind), ['create', 'move']);
  for (const op of m.readyOperations(s)) assert.equal(m.commandFor(s, op).args.section_id, 'real-section');
  assert.throws(() => m.addCollection(s, 'p', 'new COLLECTION', ids), e => e.existingCollection.id === 'real-section');
  assert.throws(() => m.addCollection(s, 'missing', 'Name', ids), /project is unavailable/);
});

test('partial collection acknowledgement missing mapping preserves UUID and blocks dependencies', () => {
  let {next: s, collection} = m.addCollection(cached(), 'p', 'New', ids);
  s = m.addBatch(s, [{content: 'Dependent', project_id: 'p', section_id: collection.id}], null, ids).next;
  s = m.markSending(s, m.readyOperations(s)); const op = s.outbox[0], cmd = op.command;
  s = m.acknowledge(s, [op], {sync_status: {[op.uuid]: 'ok'}}, 1);
  assert.deepEqual(m.readyOperations(s, 40000).map(o => o.kind), ['collection_create']);
  assert.deepEqual(m.commandFor(s, s.outbox[0]), cmd);
});

test('unchanged remote allows work; actual conflict wins privately and preserves new tasks/dependencies', () => {
  let s = m.editTask(cached(), 'r', {content: 'Local'}, ids), op = s.outbox[0];
  let unchanged = m.preflight(s, op.uuid, {task: task({labels: ['a', 'b']})});
  assert.equal(unchanged.outbox.length, 1); assert.equal(unchanged.tasks['remote:r'].content, 'Local');
  s = m.addCollection(s, 'p', 'Queued', ids).next;
  s = m.addBatch(s, [{content: 'Keep new'}], null, ids).next;
  s = m.preflight(s, op.uuid, {task: task({description: 'External'})}, 10);
  assert.equal(s.tasks['remote:r'].content, 'Remote'); assert.equal(s.tasks['remote:r'].description, 'External');
  assert.deepEqual(s.outbox.map(o => o.kind), ['collection_create', 'create']);
  assert.equal(s.conflictArchive[0].desired.content, 'Local'); assert.equal(s.syncNotices.length, 1);
  assert.equal(m.snapshot(s).conflictArchive, undefined);
});

test('explicit deletion conflicts never resurrect; missing active snapshot alone retains task', () => {
  let s = m.editTask(cached(), 'r', {content: 'Local'}, ids), op = s.outbox[0];
  s = m.replaceRemote(s, [], s.projects); assert.equal(s.outbox.length, 1);
  let unavailable = m.preflight(s, op.uuid, {status: 'unavailable'});
  assert.equal(unavailable.outbox[0].state, 'attention'); assert.equal(unavailable.tasks['remote:r'].content, 'Local');
  s = m.preflight(s, op.uuid, {task: task({is_deleted: true})});
  assert.equal(s.outbox.length, 0); assert.equal(m.mergedTasks(s).length, 0);
});

test('acknowledged updates/moves advance baseline; stale post-write read cannot roll it back', () => {
  let s = m.editTask(cached(), 'r', {content: 'Updated', section_id: 's'}, ids);
  const update = s.outbox[0]; s = accepted(s, [update]);
  assert.equal(s.tasks['remote:r'].baseRemote.content, 'Updated');
  s = m.reconcileAcknowledged(s, 'remote:r', {task: task()});
  assert.equal(s.tasks['remote:r'].baseRemote.content, 'Updated');
  s = m.preflight(s, s.outbox[0].uuid, {task: task({content: 'Updated'})});
  assert.equal(s.outbox.length, 1); assert.equal(s.syncNotices.length, 0);
});

test('recurring completion preserves exact occurrence, timestamp, series and safe unsent Undo', () => {
  const recurrence = {date: '2026-10-01', string: 'every day', is_recurring: true, timezone: 'Asia/Kolkata', lang: 'en'};
  let s = m.setCompleted(cached(task({due: recurrence})), 'r', true, ids, 1000);
  const op = s.outbox[0]; assert.equal(op.kind, 'recurring_complete'); assert.deepEqual(op.occurrence, recurrence);
  assert.equal(op.completedAt, '1970-01-01T00:00:01.000Z');
  assert.deepEqual(m.commandFor(s, op).args, {id: 'r'}); assert.equal(m.commandFor(s, op).type, 'item_close');
  assert.deepEqual(s.tasks['remote:r'].due, recurrence);
  assert.equal(m.setCompleted(s, 'r', true, ids).outbox.length, 1);
  assert.equal(m.setCompleted(s, 'r', false, ids).outbox.length, 0);
  s = m.markSending(s, [op]); assert.throws(() => m.setCompleted(s, 'r', false, ids), /only be undone before/);
  s = m.acknowledge(s, [op], {sync_status: {[op.uuid]: 'ok'}});
  assert.equal(s.tasks['remote:r'].awaitingRecurrence, true);
  s = m.replaceRemote(s, [task({due: recurrence})], s.projects); assert.equal(s.tasks['remote:r'].completed, true);
  s = m.replaceRemote(s, [task({due: {...recurrence, date: '2026-10-05'}})], s.projects);
  assert.equal(s.tasks['remote:r'].completed, false); assert.equal(s.tasks['remote:r'].occurrencePending, false);
});

test('a remotely advanced recurring occurrence is never completed by never-sent stale operation', async () => {
  const due = {date: '2026-10-01', is_recurring: true, string: 'every day'};
  const state = m.setCompleted(cached(task({due})), 'r', true, ids);
  const store = storeFor(adapter(state)); let commands = 0;
  const remote = task({due: {...due, date: '2026-10-04'}});
  await createSyncWorker(store, {userId: async () => 'user', fetchTask: async () => ({task: remote}),
    commands: async () => {commands++;}, fetchSnapshot: async () => ({tasks: [remote], projects: state.projects, sections: state.sections})}).sync();
  const s = await store.load(); assert.equal(commands, 0); assert.equal(s.outbox.length, 0); assert.equal(s.tasks['remote:r'].completed, false);
});

test('lost recurring response/restart replays the same UUID, advances once and sends later edit safely', async () => {
  const due = {date: '2026-10-01', is_recurring: true, string: 'every day'};
  let remote = task({due}), state = m.setCompleted(cached(remote), 'r', true, ids, 1000);
  const disk = adapter(state), calls = [], seen = new Set(); let lose = true, advances = 0, now = 1;
  const api = {userId: async () => 'user', fetchTask: async () => ({task: structuredClone(remote)}),
    commands: async commands => {
      calls.push(structuredClone(commands)); const sync_status = {};
      for (const c of commands) {sync_status[c.uuid] = 'ok'; if (!seen.has(c.uuid)) {
        seen.add(c.uuid); if (c.type === 'item_close') {advances++; remote.due.date = '2026-10-05';}
        else if (c.type === 'item_update') Object.assign(remote, c.args);
      }}
      if (lose) {lose = false; throw new Error('Lost reply');} return {sync_status};
    }, fetchSnapshot: async () => ({tasks: [remote], projects: state.projects, sections: state.sections})};
  await assert.rejects(createSyncWorker(storeFor(disk), api, () => now).sync(), /Lost reply/);
  const restarted = storeFor(disk); await restarted.transaction(s => m.editTask(s, 'r', {content: 'Later'}, ids));
  now = 100000; await createSyncWorker(restarted, api, () => now).sync();
  assert.equal(advances, 1); assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[2][0].type, 'item_update'); assert.equal((await restarted.load()).syncNotices.length, 0);
});

test('authoritative lookup treats active 404 as completed/unavailable, never as deleted', async () => {
  const calls = [];
  const api = createTransport('secret', async (url, options) => {
    calls.push({url, method: options.method});
    if (/\/tasks\/r$/.test(url)) return {status: 404, ok: false};
    return {ok: true, json: async () => ({items: [task({completed_at: '2026-10-02T12:00:00Z'})]})};
  }, async () => true);
  const r = await api.fetchTask('r'); assert.equal(r.task.completed, true); assert.equal(r.task.is_deleted, undefined);
  assert.equal(calls.length, 2); assert.equal(calls[0].method, 'GET');
  const missing = createTransport('secret', async () => ({ok: false, status: 404}), async () => true);
  await assert.rejects(missing.fetchTask('r'), /Invalid Todoist completed/);
});

test('reverting safely unsent updates and moves removes only changed fields without empty commands', () => {
  let s = m.editTask(cached(), 'r', {content: 'First'}, ids);
  s = m.editTask(s, 'r', {section_id: 's'}, ids);
  s = m.editTask(s, 'r', {content: 'Second', description: 'Changed'}, ids);
  assert.deepEqual(s.outbox.map(o => o.kind), ['update', 'move']);
  s = m.editTask(s, 'r', {content: 'Remote'}, ids);
  assert.deepEqual(s.outbox[0].patch, {description: 'Changed'});
  s = m.editTask(s, 'r', {description: 'Details', section_id: null}, ids);
  assert.equal(s.outbox.length, 0);
});

test('stale active snapshot after acknowledgement cannot turn our own next edit into a conflict', () => {
  let s = m.editTask(cached(), 'r', {content: 'Own accepted change'}, ids);
  s = accepted(s); s = m.replaceRemote(s, [task()], s.projects);
  assert.equal(s.tasks['remote:r'].content, 'Own accepted change');
  s = m.editTask(s, 'r', {description: 'Later'}, ids);
  s = m.preflight(s, s.outbox[0].uuid, {task: task({content: 'Own accepted change'})});
  assert.equal(s.outbox.length, 1); assert.equal(s.syncNotices.length, 0);
});

test('editing due during uncertain recurring completion preserves later intent and cannot close twice', () => {
  const due = {date: '2026-10-01', is_recurring: true, string: 'every day'};
  let s = m.setCompleted(cached(task({due})), 'r', true, ids);
  const completion = s.outbox[0]; s = m.markSending(s, [completion]);
  s = m.editTask(s, 'r', {due: null}, ids);
  s = m.setCompleted(s, 'r', true, ids);
  assert.deepEqual(s.outbox.map(o => o.kind), ['recurring_complete', 'update']);
  s = m.acknowledge(s, [completion], {sync_status: {[completion.uuid]: 'ok'}});
  s = m.reconcileAcknowledged(s, 'remote:r', {task: task({due: {...due, date: '2026-10-05'}})});
  assert.equal(s.tasks['remote:r'].due, null); assert.equal(s.outbox[0].patch.due, null);
});

test('failed mutation commit survives restart with original cached state and no pretend success', async () => {
  const disk = adapter(cached()), store = storeFor(disk);
  disk.commit = async () => {throw new Error('Disk full');};
  await assert.rejects(store.transaction(s => m.deleteTask(s, 'r', ids)), /Disk full/);
  assert.equal(m.mergedTasks(await storeFor(disk).load()).length, 1);
});

test('collection rejection and rate limit preserve dependent destinations and frozen payloads', () => {
  let {next: s, collection} = m.addCollection(cached(), 'p', 'Offline', ids);
  s = m.addBatch(s, [{content: 'Keep here', project_id: 'p', section_id: collection.id}], null, ids).next;
  const section = s.outbox[0]; s = m.markSending(s, [section]);
  s = m.acknowledge(s, [section], {sync_status: {[section.uuid]: {http_code: 400}}});
  assert.equal(m.readyOperations(s, Infinity).length, 0);
  assert.equal(Object.values(s.tasks)[0].section_id, collection.id);
  s = m.failOperations(s, [section], {status: 429, retryAfterMs: 5000, message: 'Rate limited'}, 10);
  assert.equal(m.readyOperations(s, 5009).length, 0);
  assert.deepEqual(m.readyOperations(s, 5010).map(o => o.kind), ['collection_create']);
});

test('stale form local collection aliases map to real IDs and remote metadata wins after refresh', () => {
  let {next: s, collection} = m.addCollection(cached(), 'p', 'Original name', ids);
  const op = s.outbox[0]; s = accepted(s, [op], {[op.tempId]: 'mapped'});
  s = m.replaceRemote(s, [task()], s.projects, 2, [{id: 'mapped', project_id: 'p', name: 'Remote renamed'}]);
  const batch = m.addBatch(s, [{content: 'Stale form', project_id: 'p', section_id: collection.id}], null, ids);
  assert.equal(batch.tasks[0].section_id, 'mapped');
  s = m.editTask(s, 'r', {section_id: collection.id}, ids);
  assert.equal(s.tasks['remote:r'].section_id, 'mapped'); assert.equal(m.commandFor(s, s.outbox[0]).args.section_id, 'mapped');
  assert.equal(m.mergedSections(s).find(c => c.id === 'mapped').name, 'Remote renamed');
  s = m.replaceRemote(s, [task()], s.projects, 3, []);
  assert.throws(() => m.addBatch(s, [{content: 'Unavailable', project_id: 'p', section_id: collection.id}], null, ids), /collection is unavailable/);
  s = m.checkDestinations(s); assert.equal(s.outbox[0].state, 'attention');
  assert.equal(m.mergedSections(s).find(c => c.id === 'mapped').is_deleted, true);
});

test('unavailable destinations block never-sent work but cannot rewrite an uncertain command', () => {
  let s = m.addBatch(cached(), [{content: 'Destination', project_id: 'p'}], null, ids).next;
  s.projects = []; let blocked = m.checkDestinations(s); assert.equal(blocked.outbox[0].state, 'attention');
  s.projects = [{id: 'p', name: 'Project'}]; s = m.markSending(s, [s.outbox[0]]);
  const command = s.outbox[0].command; s.projects = []; s = m.checkDestinations(s);
  assert.deepEqual(s.outbox[0].command, command); assert.equal(s.outbox[0].state, 'sending');
  assert.equal(m.snapshot(s).schema, 1, 'public Dashboard contract remains legacy compatible');
});

test('new acknowledged task server defaults become baseline before dependent mutations', () => {
  let s = m.addBatch(cached(), [{content: 'New', due: {date: '2026-10-04', string: 'every day', is_recurring: true}}], null, ids).next;
  const create = s.outbox[0]; s = m.setCompleted(s, create.localId, true, ids);
  s = accepted(s, [create], {[create.tempId]: 'new-id'});
  const remote = task({id: 'new-id', content: 'New', description: '', priority: 1, labels: [], due: {date: '2026-10-04', string: 'every day', is_recurring: true, lang: 'en', timezone: null}});
  s = m.reconcileAcknowledged(s, create.localId, {task: remote});
  s = m.preflight(s, s.outbox[0].uuid, {task: remote});
  assert.equal(s.syncNotices.length, 0); assert.equal(s.outbox[0].kind, 'recurring_complete');
});
