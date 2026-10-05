const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../src/offline/model');
const locations = require('../src/offline/locations');
const bulk = require('../src/offline/bulk');
const order = require('../src/offline/order');
const {createStore} = require('../src/offline/store');
const {createSyncWorker} = require('../src/offline/sync');
const {createTransport} = require('../src/offline/transport');
let sequence = 0;
const ids = () => `native-uuid-${++sequence}`;
const project = {id: 'p', name: 'Project', parent_id: null, created_at: '2026-10-01T00:00:00Z'};
const inbox = {id: 'inbox', name: 'Inbox', inbox_project: true};
const task = (id, patch = {}) => ({id, content: id, project_id: 'p', section_id: null, parent_id: null, description: '', labels: [], priority: 1, order_key: id === 'a' ? 'a0' : 'a1', ...patch});
function state(tasks = [task('a'), task('b')]) {return m.replaceRemote(m.emptyStore('account', 'device'), tasks, [project, inbox], 1, [{id: 's', name: 'Collection', project_id: 'p', added_at: project.created_at}]);}
function accept(s, mapping = {}) {
  const ready = m.readyOperations(s); s = m.markSending(s, ready);
  return m.acknowledge(s, ready, {sync_status: Object.fromEntries(ready.map(op => [op.uuid, 'ok'])), temp_id_mapping: mapping});
}
function remove(s, kind, id, extra = {}) {
  const plan = locations.scope(s, kind, id, m);
  return locations.remove(s, kind, id, {scopeToken: plan.scopeToken, confirmCount: plan.count, mode: 'delete', includeUncached: true, ...extra}, ids, m);
}
test('project creation and dependent collection/task map in acknowledged order; frozen replay survives restart validation', () => {
  const created = locations.createProject(state([]), 'Offline project', ids);
  let s = m.addCollection(created.next, created.project.id, 'New collection', ids).next;
  const section = Object.values(s.collections)[0];
  s = m.addBatch(s, [{content: 'New task', project_id: created.project.id, section_id: section.id}], null, ids).next;
  assert.deepEqual(m.readyOperations(s).map(op => op.kind), ['project_create']);
  s = m.markSending(s, m.readyOperations(s)); const frozen = m.commandFor(s, s.outbox[0]);
  const renamed = locations.rename(s, 'project', created.project.id, 'Later name', ids);
  assert.deepEqual(m.commandFor(renamed, renamed.outbox[0]), frozen);
  m.validateStore(JSON.parse(JSON.stringify(renamed)), 'account', 'device');
  s = accept(renamed, {[renamed.outbox[0].tempId]: 'new-project'});
  assert.equal(Object.values(s.collections)[0].project_id, 'new-project');
  assert.deepEqual(m.readyOperations(s).map(op => op.kind), ['collection_create', 'project_rename']);
  const sectionOp = s.outbox.find(op => op.kind === 'collection_create');
  s = accept(s, {[sectionOp.tempId]: 'new-section'});
  assert.deepEqual(m.commandFor(s, m.readyOperations(s).find(op => op.kind === 'create')).args.project_id, 'new-project');
  assert.equal(Object.values(s.tasks)[0].section_id, 'new-section');
});
test('unsent project/collection rename folds and local cascade safely cancels task creation', () => {
  const created = locations.createProject(state([]), 'Before', ids);
  let s = locations.rename(created.next, 'project', created.project.id, 'After', ids);
  assert.equal(s.outbox.length, 1);
  s = m.addBatch(s, [{content: 'Local', project_id: created.project.id}], null, ids).next;
  s = remove(s, 'project', created.project.id);
  assert.equal(s.outbox.length, 0); assert.equal(Object.keys(s.tasks).length, 0);
  assert.equal(locations.mergedProjects(s).some(p => p.name === 'After'), false);
});
test('local keep cancels unsent container only after dependent task destination is changed', () => {
  const created = locations.createProject(state([]), 'Temporary', ids);
  let s = m.addBatch(created.next, [{content: 'Retained', project_id: created.project.id}], null, ids).next;
  s = remove(s, 'project', created.project.id, {mode: 'keep', destinationProjectId: 'inbox'});
  assert.deepEqual(s.outbox.map(op => op.kind), ['create']);
  assert.equal(Object.values(s.tasks)[0].project_id, 'inbox');
});
test('Inbox, read-only and unknown shared permissions are protected without affecting original state', () => {
  const s = state();
  assert.throws(() => locations.rename(s, 'project', 'inbox', 'No', ids), /Inbox/);
  for (const patch of [{is_read_only: true}, {is_shared: true}, {role: 'viewer'}]) {
    const restricted = {...s, projects: [{...project, ...patch}, inbox]};
    assert.equal(locations.scope(restricted, 'project', 'p', m).allowed, false);
  }
  assert.equal(s.outbox.length, 0);
});
test('offline history incompleteness blocks retention, explicit cascade names uncached contents', () => {
  const s = state(), plan = locations.scope(s, 'project', 'p', m);
  assert.equal(plan.canKeep, false); assert.equal(plan.countIsMinimum, true);
  assert.throws(() => remove(s, 'project', 'p', {mode: 'keep', destinationProjectId: 'inbox'}), /complete scope/);
  assert.throws(() => remove(s, 'project', 'p', {includeUncached: false}), /uncached completed history/);
  const next = remove(s, 'project', 'p');
  assert.equal(m.mergedTasks(next).length, 0);
  assert.equal(next.outbox[0].recovery.includeUncached, true);
});
test('descendant projects and outside parents cannot be flattened by retention', () => {
  let s = state(); s.projects.push({id: 'child', name: 'Child', parent_id: 'p'});
  assert.throws(() => remove(s, 'project', 'p'), /descendant projects separately/);
  s = state([task('a', {section_id: 's', parent_id: 'outside'})]);
  const plan = locations.scope(s, 'collection', 's', m); s.containerScopes = {'collection:s': {complete: true, authority: 'server-total', count: plan.count, token: plan.scopeToken}};
  assert.throws(() => remove(s, 'collection', 's', {mode: 'keep'}), /parent is outside/);
});
test('remote container preflight rejects new contents, changed permissions and changed sibling location', () => {
  let s = remove(state(), 'project', 'p'); const op = s.outbox[0];
  s.remote.push(task('new')); locations.preflight(s, op);
  assert.equal(op.state, 'attention'); assert.match(op.error, /contents changed/);
  assert.equal(locations.mergedProjects(s).some(p => p.id === 'p'), true);
  assert.equal(m.mergedTasks(s).length, 3);
  assert.equal(op.projectionRolledBack, true);
  assert.equal(s.syncNotices.length, 1);
  s = remove(state(), 'collection', 's'); s.projects[0].is_read_only = true;
  locations.preflight(s, s.outbox[0]); assert.equal(s.outbox[0].state, 'attention');
});
test('uncertain child update stays an immutable dependency before container cascade', () => {
  let s = m.editTask(state(), 'a', {priority: 4}, ids);
  s = m.markSending(s, m.readyOperations(s)); const frozen = s.outbox[0].command;
  s = remove(s, 'project', 'p');
  const deletion = s.outbox.find(op => op.kind === 'project_delete');
  assert.deepEqual(deletion.dependencies, [s.outbox[0].uuid]);
  assert.equal(m.readyOperations(s).some(op => op.kind === 'project_delete'), false);
  assert.deepEqual(m.commandFor(s, s.outbox[0]), frozen);
});
test('atomic bulk edits affect selected field and stable identity prevents duplicate retry after uncertain reply', async () => {
  let disk = JSON.stringify(state());
  const store = createStore({read: async () => ({exists: true, main: disk}), commit: async next => {disk = next;}}, 'account', 'device');
  await store.transaction(s => bulk.mutate(s, ['a', 'b'], {kind: 'edit', patch: {priority: 4}}, ids, 'request', m).next);
  let s = await store.load(); assert.equal(s.revision, 1); assert.equal(s.outbox.length, 2);
  const results = bulk.mutate(s, ['a', 'b'], {kind: 'edit', patch: {priority: 4}}, ids, 'request', m);
  assert.equal(results.next.outbox.length, 2); assert.equal(results.results.length, 2);
  assert.equal(results.next.tasks['remote:a'].description, '');
  assert.throws(() => bulk.mutate(s, ['a', 'b'], {kind: 'edit', patch: {priority: 2}}, ids, 'request', m), /different changes/);
  assert.throws(() => bulk.mutate(s, ['a', 'missing'], {kind: 'delete'}, ids, 'another', m), /unavailable/);
  assert.equal((await store.load()).tasks['remote:a'].deleted, undefined);
});
test('bulk recurring reopen restriction rejects entire transaction', () => {
  const s = state([task('a'), task('b', {due: {date: '2026-10-05', is_recurring: true}, completed: true})]);
  assert.throws(() => bulk.mutate(s, ['a', 'b'], {kind: 'complete', completed: false}, ids, 'reopen', m), /Recurring completion/);
  assert.equal(s.outbox.length, 0);
});
test('order_key Up/Down mutates only one sibling and remote membership conflict cancels unsent order', () => {
  let s = order.reorder(state(), 'b', 'up', ids, m);
  assert.ok(s.tasks['remote:b'].order_key < 'a0');
  const op = s.outbox[0], command = m.commandFor(s, op);
  assert.equal(command.type, 'item_update'); assert.deepEqual(Object.keys(command.args).sort(), ['id', 'order_key']);
  assert.equal(s.remote[0].order_key, 'a0');
  s.remote.push(task('new', {order_key: 'a2'})); order.preflight(s, op, m);
  assert.equal(s.outbox.length, 0); assert.equal(s.tasks['remote:b'].order_key, 'a1');
});
test('ordering preserves parent and collection scope, rejects unmigrated keys and retains frozen UUID payload', () => {
  const s = state([task('a'), task('b'), task('child', {parent_id: 'a', order_key: 'a0'}), task('section', {section_id: 's', order_key: 'a0'})]);
  assert.equal(order.reorder(s, 'child', 'up', ids, m).outbox.length, 0);
  assert.throws(() => order.reorder(state([task('a', {order_key: null}), task('b')]), 'b', 'up', ids, m), /unavailable/);
  let next = order.reorder(s, 'a', 'down', ids, m); next = m.markSending(next, m.readyOperations(next));
  const command = next.outbox[0].command; next = order.reorder(next, 'a', 'up', ids, m);
  assert.deepEqual(m.commandFor(next, next.outbox[0]), command); assert.equal(next.outbox.length, 2);
});
test('fractional keys cover prefix gaps and boundaries without deprecated renumbering', () => {
  for (const [left, right] of [[null, 'a0'], ['a0', null], ['a0', 'a0V'], ['a0', 'a01'], ['a0V', 'a0VV'], ['a0z', 'a1']]) {
    const key = order.between(left, right); assert.ok(left === null || left < key); assert.ok(right === null || key < right);
  }
});
test('reorder preflight preserves unrelated remote edits and later local field intents', () => {
  let s = order.reorder(state(), 'b', 'up', ids, m);
  s = m.editTask(s, 'b', {description: 'Later local description'}, ids);
  s.remote[1].content = 'Remote renamed'; s.remote[1].description = 'Remote description';
  order.preflight(s, s.outbox[0], m);
  assert.equal(s.tasks['remote:b'].content, 'Remote renamed');
  assert.equal(s.tasks['remote:b'].description, 'Later local description');
  assert.equal(s.tasks['remote:b'].baseRemote.content, 'Remote renamed');
  assert.equal(s.outbox[0].kind, 'reorder');
});
test('worker container delete sees current snapshot immediately before send and skips task-specific fetch', async () => {
  let disk = JSON.stringify(remove(state(), 'project', 'p')), sent = [];
  const store = createStore({read: async () => ({exists: true, main: disk}), commit: async next => {disk = next;}}, 'account', 'device');
  const api = {userId: async () => 'u', fetchSnapshot: async () => ({tasks: state().remote, projects: [project, inbox], sections: []}),
    fetchContainerHistorySince: async () => ({complete: true, tasks: []}),
    fetchArchivedProjects: async () => ({complete: true, projects: []}),
    fetchTask: async () => {throw new Error('container must not fetch a task');}, commands: async commands => {sent.push(...commands); return {sync_status: Object.fromEntries(commands.map(c => [c.uuid, 'ok']))};}};
  await createSyncWorker(store, api).sync();
  assert.equal(sent[0].type, 'project_delete'); assert.equal((await store.load()).outbox.length, 0);
});
test('remote keep preserves subtask hierarchy and requires acknowledged retention receipts', () => {
  let s = state([task('a'), task('child', {parent_id: 'a', order_key: 'a0'})]);
  const plan = locations.scope(s, 'project', 'p', m);
  s.containerScopes = {'project:p': {complete: true, authority: 'server-total', count: plan.count, token: plan.scopeToken}};
  s = remove(s, 'project', 'p', {mode: 'keep', destinationProjectId: 'inbox'});
  assert.equal(s.tasks['remote:child'].parent_id, 'a');
  assert.equal(s.tasks['remote:child'].project_id, 'inbox');
  assert.deepEqual(m.readyOperations(s).map(op => op.kind), ['move']);
  const deletion = s.outbox.find(op => op.kind === 'project_delete'), dependency = deletion.dependencies[0];
  s = accept(s);
  assert.equal(s.acknowledgedOperations[dependency], true);
  assert.deepEqual(m.readyOperations(s).map(op => op.kind), ['project_delete']);
});
test('a cancelled dependency cannot unblock parent deletion and restoration exposes attention', () => {
  let s = state(); const plan = locations.scope(s, 'project', 'p', m);
  s.containerScopes = {'project:p': {complete: true, authority: 'server-total', count: plan.count, token: plan.scopeToken}};
  s = remove(s, 'project', 'p', {mode: 'keep', destinationProjectId: 'inbox'});
  s.outbox = s.outbox.filter(op => op.kind === 'project_delete');
  locations.reconcile(s);
  assert.equal(s.outbox[0].state, 'attention'); assert.match(s.outbox[0].error, /cancelled or conflicted/);
  assert.equal(m.readyOperations(s).length, 0);
});
test('location rename conflict preserves Todoist version and acknowledged creation mapping cannot be lost', () => {
  let s = locations.rename(state(), 'collection', 's', 'Local name', ids);
  s.sections[0].name = 'Remote name'; locations.preflight(s, s.outbox[0]);
  assert.equal(s.outbox.length, 0); assert.equal(locations.find(s, 'collection', 's').name, 'Remote name');
  const created = locations.createProject(state([]), 'New', ids); s = m.markSending(created.next, m.readyOperations(created.next));
  s = m.acknowledge(s, s.outbox, {sync_status: {[s.outbox[0].uuid]: 'ok'}, temp_id_mapping: {}});
  assert.equal(s.outbox.length, 1); assert.equal(s.outbox[0].attempts, 1); assert.equal(s.localProjects[created.project.id].remoteId, null);
});
test('history verifier uses authenticated account lifetime, paginates and stops at a hard budget', async () => {
  const joined = new Date(Date.now() - 86400000).toISOString(), calls = [];
  const transport = createTransport('private', async (url, request) => {
    calls.push(url);
    if (url.endsWith('/sync')) {return {ok: true, json: async () => ({user: {id: 'u', joined_at: joined}})};}
    assert.ok(url.includes('section_id=s'));
    if (!url.includes('cursor=')) {return {ok: true, json: async () => ({items: [task('a', {completed_at: joined})], next_cursor: 'next'})};}
    return {ok: true, json: async () => ({items: [], next_cursor: null})};
  }, async () => true);
  let result = await transport.verifyContainerHistory('collection', 's', '2026-10-05T00:00:00Z', 1);
  assert.equal(result.complete, false); assert.equal(calls.length, 2);
  result = await transport.verifyContainerHistory('collection', 's', null, 3);
  assert.equal(result.complete, true); assert.equal(result.tasks.length, 1);
  assert.ok(calls.some(url => url.includes(encodeURIComponent(joined))));
});
test('missing account lifetime and incomplete archived pagination never claim verified scope', async () => {
  const transport = createTransport('private', async url => ({ok: true, json: async () => url.endsWith('/sync') ? {user: {id: 'u'}} : {results: [project], next_cursor: 'more'}}), async () => true);
  assert.equal((await transport.verifyContainerHistory('project', 'p', project.created_at)).complete, false);
  const archives = await transport.fetchArchivedProjects(1);
  assert.equal(archives.complete, false); assert.equal(archives.projects.length, 1);
});
test('schema validates location identities, scope metadata, dependency shape and immutable ordering payload', () => {
  for (const patch of [{localProjects: []}, {containerScopes: {p: {complete: true}}}, {acknowledgedOperations: {uuid: false}}, {archivedProjects: {}}]) {
    assert.throws(() => m.validateStore({...state(), ...patch}, 'account', 'device'), /Damaged/);
  }
  let s = remove(state(), 'project', 'p'); delete s.outbox[0].recovery;
  assert.throws(() => m.validateStore(s, 'account', 'device'), /Damaged container/);
});
test('rejected deletion restores remote fields and a fresh confirmation replaces its unsent intent', () => {
  let s = remove(state(), 'project', 'p');
  s.remote[0].content = 'Changed remotely'; s.remote.push(task('new'));
  const old = s.outbox[0].uuid; locations.preflight(s, s.outbox[0]);
  assert.equal(m.cachedView(s, 'a').content, 'Changed remotely');
  assert.equal(s.conflictArchive.length, 1);
  const restored = JSON.parse(JSON.stringify(s)); m.validateStore(restored, 'account', 'device');
  s = remove(restored, 'project', 'p');
  assert.equal(s.outbox.length, 1); assert.notEqual(s.outbox[0].uuid, old);
  assert.equal(s.outbox[0].recovery.activeBaseline.length, 3);
});
test('missing archived/history verification leaves a visible container and cached tasks for review', async () => {
  let disk = JSON.stringify(remove(state(), 'project', 'p')), sent = 0;
  const store = createStore({read: async () => ({exists: true, main: disk}), commit: async next => {disk = next;}}, 'account', 'device');
  const api = {userId: async () => 'u', fetchSnapshot: async () => ({tasks: state().remote, projects: [project, inbox], sections: []}),
    fetchArchivedProjects: async () => ({complete: false, projects: []}), commands: async () => {sent++; throw new Error('must not send');}};
  await createSyncWorker(store, api).sync();
  const s = await store.load(); assert.equal(sent, 0); assert.equal(s.outbox[0].state, 'attention');
  assert.equal(locations.mergedProjects(s).some(p => p.id === 'p'), true); assert.equal(m.mergedTasks(s).length, 2);
});
test('a completed dated scan cannot enable remote Keep or claim imported historical completeness', async () => {
  let disk = JSON.stringify(state());
  const store = createStore({read: async () => ({exists: true, main: disk}), commit: async next => {disk = next;}}, 'account', 'device');
  const api = {userId: async () => 'u', fetchSnapshot: async () => ({tasks: state().remote, projects: [project, inbox], sections: []}),
    fetchArchivedProjects: async () => ({complete: true, projects: []}),
    verifyContainerHistory: async () => ({complete: true, tasks: []})};
  const plan = await createSyncWorker(store, api).verifyContainer('project', 'p');
  assert.equal(plan.canKeep, false); assert.equal(plan.complete, false);
  assert.match(plan.keepReason, /backdated/);
  assert.equal((await store.load()).containerScopes['project:p'].complete, false);
  const s = state(), old = locations.scope(s, 'project', 'p', m);
  s.containerScopes = {'project:p': {complete: true, token: old.scopeToken}};
  assert.equal(locations.scope(s, 'project', 'p', m).canKeep, false);
});
