const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../src/offline/model');
const {createStore} = require('../src/offline/store');
const {createSyncWorker} = require('../src/offline/sync');

let sequence = 0;
const ids = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
const initial = () => m.emptyStore('account-a', 'device-a');
const add = (s, n = 1) => m.addBatch(s, Array.from({length: n}, (_, i) => ({content: `Task ${i}`})),
  {filePath: '/Note/scratch.note', pageNum: 2, lassoElementIds: ['unstable']}, ids, 123).next;

function memoryAdapter(data) {
  return {main: data ? JSON.stringify(data) : null, backup: null, fail: false, commits: 0,
    async read() { return {exists: !!(this.main || this.backup), main: this.main, backup: this.backup}; },
    async commit(next, previous) {
      if (this.fail) throw new Error('Disk full');
      this.backup = previous; this.main = next; this.commits++;
    }};
}
const makeStore = adapter => createStore(adapter, 'account-a', 'device-a');

test('ten-task batch owns stable task/operation IDs and stores only stable source anchors', () => {
  const s = add(initial(), 10);
  assert.equal(Object.keys(s.tasks).length, 10);
  assert.equal(s.outbox.length, 10);
  assert.equal(new Set(s.outbox.map(op => op.uuid)).size, 10);
  assert.equal(new Set(Object.values(s.tasks).map(t => t.batchId)).size, 1);
  assert.deepEqual(Object.values(s.tasks)[0].source, {filePath: '/Note/scratch.note', pageNum: 2, bounds: null});
});

test('invalid item prevents any batch from being saved', () => {
  const s = initial();
  assert.throws(() => m.addBatch(s, [{content: 'Valid'}, {content: ' '}], null, ids), /title/);
  assert.equal(s.outbox.length, 0);
});

test('relative date resolves at capture and invalid calendar dates are rejected', () => {
  const date = new Date(2026, 9, 3, 23, 59).getTime();
  assert.equal(m.resolveDue('tomorrow', date).date, '2026-10-04');
  assert.throws(() => m.resolveDue('2026-02-30'), /calendar/);
  assert.throws(() => m.resolveDue('next Friday'), /calendar/);
});

test('failed disk commit does not claim success or change memory and later save can retry', async () => {
  const disk = memoryAdapter(); const store = makeStore(disk);
  disk.fail = true;
  await assert.rejects(store.transaction(s => add(s)), /Disk full/);
  assert.equal((await store.load()).outbox.length, 0);
  disk.fail = false;
  await store.transaction(s => add(s));
  assert.equal((await makeStore(disk).load()).outbox.length, 1);
});

test('concurrent captures serialize without dropping either task', async () => {
  const store = makeStore(memoryAdapter());
  await Promise.all([store.transaction(s => add(s)), store.transaction(s => add(s))]);
  const state = await store.load();
  assert.equal(state.outbox.length, 2);
  assert.equal(state.revision, 2);
});

test('corruption recovers previous generation visibly; two damaged generations never overwrite', async () => {
  const disk = memoryAdapter(add(initial()));
  disk.backup = disk.main; disk.main = '{';
  const store = makeStore(disk);
  assert.equal((await store.load()).outbox.length, 1);
  assert.match(store.getWarning(), /Recovered/);
  disk.backup = 'null';
  const broken = makeStore(disk);
  await assert.rejects(broken.transaction(s => add(s)), /no empty replacement/);
  assert.equal(disk.commits, 0);
});

test('account and device binding reject copied queues', async () => {
  const disk = memoryAdapter(add(initial()));
  await assert.rejects(createStore(disk, 'account-b', 'device-a').load(), /damaged or unsupported/);
  await assert.rejects(createStore(disk, 'account-a', 'device-b').load(), /damaged or unsupported/);
});

test('sending freezes payload and UUID; editing/cancelling uncertain operations is rejected', () => {
  const s = add(initial()); const op = s.outbox[0];
  const sent = m.markSending(s, [op]);
  assert.equal(sent.outbox[0].attempts, 1);
  assert.throws(() => m.editUnsent(sent, op.localId, {content: 'Changed'}), /may already/);
  assert.throws(() => m.cancelUnsent(sent, op.localId), /may already/);
  sent.tasks[op.localId].content = 'Do not leak this into retry';
  assert.equal(m.commandFor(sent, sent.outbox[0]).args.content, 'Task 0');
  assert.equal(m.commandFor(sent, sent.outbox[0]).uuid, op.uuid);
});

test('unsent edit/cancel is safe and acknowledged command IDs map atomically', () => {
  let s = add(initial(), 2); const op = s.outbox[0];
  s = m.editUnsent(s, op.localId, {content: 'Correction'});
  assert.equal(m.commandFor(s, s.outbox[0]).args.content, 'Correction');
  s = m.cancelUnsent(s, s.outbox[1].localId);
  s = m.markSending(s, s.outbox);
  s = m.acknowledge(s, s.outbox, {sync_status: {[op.uuid]: 'ok'}, temp_id_mapping: {[op.tempId]: 'remote-id'}});
  assert.equal(s.outbox.length, 0);
  assert.equal(s.tasks[op.localId].remoteId, 'remote-id');
});

test('HTTP 200 with partial rejection/missing mapping leaves unresolved commands queued', () => {
  let s = add(initial(), 3); s = m.markSending(s, s.outbox);
  const [a, b, c] = s.outbox;
  s = m.acknowledge(s, s.outbox, {sync_status: {[a.uuid]: 'ok', [b.uuid]: {http_code: 400, error: 'Project deleted'}, [c.uuid]: 'ok'},
    temp_id_mapping: {[a.tempId]: 'accepted'}}, 100);
  assert.equal(s.outbox.length, 2);
  assert.equal(s.outbox[0].state, 'attention');
  assert.equal(s.outbox[1].uuid, c.uuid);
  assert.equal(s.outbox[1].state, 'pending');
  assert.equal(s.tasks[a.localId].remoteId, 'accepted');
});

test('create then complete waits for ID, while a later reopen cannot overtake uncertain completion', () => {
  let s = add(initial()); const create = s.outbox[0];
  s = m.setCompleted(s, create.localId, true, ids);
  assert.deepEqual(m.readyOperations(s).map(op => op.kind), ['create']);
  s = m.markSending(s, [create]);
  s = m.acknowledge(s, [create], {sync_status: {[create.uuid]: 'ok'}, temp_id_mapping: {[create.tempId]: 'remote'}});
  const completion = m.readyOperations(s)[0];
  s = m.markSending(s, [completion]);
  s = m.setCompleted(s, create.localId, false, ids);
  assert.deepEqual(m.readyOperations(s).map(op => op.kind), ['complete']);
  s = m.acknowledge(s, [completion], {sync_status: {[completion.uuid]: 'ok'}});
  assert.deepEqual(m.readyOperations(s).map(op => op.kind), ['reopen']);
});

test('offline completion/reopen of an active fetched task coalesces before first send', () => {
  let s = m.replaceRemote(initial(), [{id: 'remote', content: 'Fetched'}], []);
  s = m.setCompleted(s, 'remote', true, ids);
  s = m.setCompleted(s, 'remote', false, ids);
  assert.equal(s.outbox.length, 0);
  assert.equal(m.mergedTasks(s)[0].completed, false);
});

test('429/backoff and permanent rejection keep dependent commands blocked', () => {
  let s = add(initial()); const op = s.outbox[0];
  s = m.markSending(s, [op]);
  s = m.failOperations(s, [op], {status: 429, message: 'Rate limited', retryAfterMs: 60000}, 1000);
  assert.equal(m.readyOperations(s, 60999).length, 0);
  assert.equal(m.readyOperations(s, 61000).length, 1);
  s = m.failOperations(s, [op], {status: 401, message: 'Token revoked'}, 61000);
  assert.equal(m.readyOperations(s, 999999).length, 0);
});

test('remote refresh retains pending overlays and snapshots exclude credentials/outbox', () => {
  let s = add(initial());
  s = m.replaceRemote(s, [{id: 'remote', content: 'Another'}], [], 99);
  assert.equal(m.mergedTasks(s).length, 2);
  const exported = m.snapshot(s);
  assert.equal(exported.pendingCount, 1);
  assert.equal(exported.lastSync, 99);
  assert.equal(exported.accountKey, undefined);
  assert.equal(exported.outbox, undefined);
  assert.equal(exported.tasks[1].description, undefined);
});

test('lost reply after acceptance and process restart replay identical commands exactly once', async () => {
  const disk = memoryAdapter(add(initial(), 10));
  const accepted = new Map(); const calls = [];
  let loseReply = true; let now = 1000;
  const api = {async userId() { return 'user-a'; },
    async commands(commands) {
      calls.push(commands);
      const result = {sync_status: {}, temp_id_mapping: {}};
      for (const cmd of commands) {
        if (!accepted.has(cmd.uuid)) accepted.set(cmd.uuid, `remote-${accepted.size}`);
        result.sync_status[cmd.uuid] = 'ok'; result.temp_id_mapping[cmd.temp_id] = accepted.get(cmd.uuid);
      }
      if (loseReply) { loseReply = false; throw new Error('Reply lost'); }
      return result;
    }, async fetchSnapshot() { return {tasks: [], projects: []}; }};
  await assert.rejects(createSyncWorker(makeStore(disk), api, () => now).sync(), /Reply lost/);
  now = 100000;
  const restarted = makeStore(disk);
  await createSyncWorker(restarted, api, () => now).sync();
  assert.equal(accepted.size, 10);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal((await restarted.load()).outbox.length, 0);
});

test('worker verifies user before upload and deduplicates concurrent runs', async () => {
  const state = add(initial()); state.userId = 'user-a';
  const store = makeStore(memoryAdapter(state)); let calls = 0;
  const api = {async userId() { return 'user-b'; }, async commands() { calls++; }};
  const worker = createSyncWorker(store, api);
  const a = worker.sync(); const b = worker.sync();
  assert.equal(a, b);
  await assert.rejects(a, /account changed/);
  assert.equal(calls, 0);
  assert.equal((await store.load()).outbox.length, 1);
});
