const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createIntentQueue, projectTasks, composerDefaults} = require('../src/workspace/intents');
const {reorderProjection, projectContainers, projectContainerTasks} = require('../src/workspace/intents');
const {resolveContainerId, rowIdentity, protectedOccurrence, orderedTasks} = require('../src/workspace/intents');
const gate = () => {let resolve; const promise = new Promise(r => {resolve = r;}); return {promise, resolve};};
test('intersecting edits serialize but unrelated rows commit immediately', async () => {
  const first = gate(); const calls = []; const errors = [];
  const queue = createIntentQueue({changed() {}, failed(e) {errors.push(e);}, async commit(ids, action) {
    calls.push([ids[0], action.patch.content]);
    if (action.patch.content === 'first') await first.promise;
  }});
  const a = queue.submit(['a'], {kind: 'edit', patch: {content: 'first'}});
  const b = queue.submit(['a'], {kind: 'edit', patch: {content: 'second'}});
  const c = queue.submit(['b'], {kind: 'edit', patch: {content: 'independent'}});
  await c;
  assert.deepEqual(calls, [['a', 'first'], ['b', 'independent']]);
  assert.equal(projectTasks([{id: 'a', content: 'original'}], queue.snapshot())[0].content, 'second');
  first.resolve(); await Promise.all([a, b]);
  assert.deepEqual(calls.at(-1), ['a', 'second']); assert.equal(queue.snapshot().length, 0); assert.deepEqual(errors, []);
});
test('failure removes only its own projection and later edit remains usable', async () => {
  const errors = [];
  const queue = createIntentQueue({changed() {}, failed(e) {errors.push(e.message);}, async commit(ids, action) {
    if (action.kind === 'delete') throw new Error('disk unavailable');
  }});
  const failed = queue.submit(['a'], {kind: 'delete'}).catch(() => {});
  const next = queue.submit(['a'], {kind: 'edit', patch: {priority: 4}});
  await Promise.all([failed, next]);
  assert.deepEqual(errors, ['disk unavailable']); assert.deepEqual(queue.snapshot(), []);
});
test('completion selection IDs are deduplicated and contextual defaults use selected project', async () => {
  let committed;
  const queue = createIntentQueue({changed() {}, failed() {}, async commit(ids) {committed = ids;}});
  await queue.submit(['1', '1'], {kind: 'complete', completed: true});
  assert.deepEqual(committed, ['1']);
  assert.deepEqual(composerDefaults('project:p', [], '2026-10-05', '2026-10-06', {defaultProjectId: 'other'}),
    {projectId: 'p', sectionId: null, dueDate: ''});
});
test('up/down crosses only siblings in the same collection and parent', () => {
  const tasks = [{id: 'a', project_id: 'p', section_id: 's'}, {id: 'other', project_id: 'p', section_id: 't'},
    {id: 'child', project_id: 'p', section_id: 's', parent_id: 'a'}, {id: 'b', project_id: 'p', section_id: 's'}];
  assert.deepEqual(reorderProjection(tasks, 'b', 'up').map(task => task.id), ['b', 'other', 'child', 'a']);
  assert.deepEqual(reorderProjection(tasks, 'a', 'up'), tasks);
  assert.deepEqual(tasks.map(task => task.id), ['a', 'other', 'child', 'b']);
});
test('container rename/delete projections preserve unrelated containers and tasks', () => {
  const projects = [{id: 'p', name: 'Home'}, {id: 'q', name: 'Work'}];
  const rename = [{scope: 'project', action: 'rename', id: 'p', name: 'House'}];
  assert.equal(projectContainers(projects, rename, 'project')[0].name, 'House');
  assert.equal(projects[0].name, 'Home');
  const tasks = [{id: 'a', project_id: 'p', section_id: 's'}, {id: 'b', project_id: 'q'}];
  const keep = [{scope: 'project', action: 'delete', id: 'p', mode: 'keep', destinationProjectId: 'inbox'}];
  assert.deepEqual(projectContainerTasks(tasks, keep)[0], {id: 'a', project_id: 'inbox', section_id: null, syncState: 'pending'});
  assert.deepEqual(projectContainerTasks(tasks, keep)[1], tasks[1]);
  assert.equal(projectContainers(projects, keep, 'project').length, 1);
  assert.equal(projectContainerTasks(tasks, [{...keep[0], mode: 'delete'}])[0].deleted, true);
});
test('uncertain saves retain frozen payload and identity; newer intersecting changes wait for reconciliation', async () => {
  const calls = [], failed = []; let once = true;
  const queue = createIntentQueue({changed() {}, failed(error, intent) {failed.push(intent);}, async commit(ids, action, request) {
    request.ids ||= ['fixed-request']; calls.push({ids, action: structuredClone(action), identity: request.ids[0]});
    if (ids[0] === 'a' && once) {once = false; const error = new Error('reply lost'); error.uncertainCommit = true; throw error;}
  }});
  const action = {kind: 'edit', patch: {labels: ['original']}};
  await queue.submit(['a'], action).catch(() => {}); action.patch.labels.push('changed outside');
  await queue.submit(['a'], {kind: 'complete', completed: true}).catch(() => {});
  await queue.submit(['unrelated'], {kind: 'edit', patch: {priority: 4}});
  assert.equal(calls.filter(call => call.ids[0] === 'a').length, 1);
  assert.equal(queue.snapshot().length, 2);
  await queue.retry(failed[0].sequence); await queue.retry(failed[1].sequence);
  assert.deepEqual(calls.filter(call => call.ids[0] === 'a').map(call => call.action), [
    {kind: 'edit', patch: {labels: ['original']}}, {kind: 'edit', patch: {labels: ['original']}}, {kind: 'complete', completed: true}]);
  assert.equal(calls[0].identity, calls[2].identity); assert.deepEqual(queue.snapshot(), []);
});
test('queued old-account work cancels before dispatch and retry cannot cross accounts', async () => {
  let account = 'first', calls = 0; const first = gate();
  const queue = createIntentQueue({account: () => account, changed() {}, failed() {}, async commit() {calls++; await first.promise;}});
  const a = queue.submit(['a'], {kind: 'complete', completed: true});
  const b = queue.submit(['a'], {kind: 'complete', completed: false});
  await Promise.resolve(); await Promise.resolve();
  account = 'second'; queue.cancel(); first.resolve(); await Promise.all([a, b]);
  assert.equal(calls, 1); assert.deepEqual(queue.snapshot(), []);
});
test('project aliases resolve while stable selection identities survive remote ownership', () => {
  assert.equal(resolveContainerId('local-project', [{id: 'remote-project', localId: 'local-project'}]), 'remote-project');
  assert.equal(rowIdentity({id: '42'}), rowIdentity({id: 'remote:42', remoteId: '42'}));
  assert.equal(rowIdentity({id: 'local-created', remoteId: '42'}), 'local-created');
});
test('recurring history has distinct occurrence identity and never projects onto the active next occurrence', () => {
  const task = {id: '42', completed: true, occurrenceHistory: true, completed_at: '2026-10-05', due: {date: '2026-10-05', is_recurring: true}};
  assert.notEqual(rowIdentity(task), rowIdentity({...task, completed: false}));
  assert.notEqual(rowIdentity(task), rowIdentity({...task, completed_at: '2026-10-06'}));
  assert.equal(protectedOccurrence(task), true);
  assert.equal(protectedOccurrence({...task, occurrenceHistory: false}, [{id: '42', kind: 'recurring_complete', attempts: 0, state: 'pending'}]), false);
  assert.equal(protectedOccurrence({...task, occurrenceHistory: false}, [{id: '42', kind: 'recurring_complete', attempts: 1, state: 'attention'}]), true);
  assert.equal(projectTasks([task], [{kind: 'complete', ids: ['42'], completed: false}])[0].completed, true);
});
test('smart capture defaults use Inbox and sibling order keys survive different due dates', () => {
  const projects = [{id: 'inbox', is_inbox_project: true}];
  assert.deepEqual(composerDefaults('today', projects, '2026-10-05', '2026-10-06', {defaultProjectId: 'work', defaultSectionId: 'section'}), {projectId: 'inbox', sectionId: null, dueDate: '2026-10-05'});
  const tasks = [{id: 'b', project_id: 'p', order_key: 'a1', due: {date: '2026-10-05'}}, {id: 'other', project_id: 'q', order_key: 'a0'}, {id: 'a', project_id: 'p', order_key: 'a0', due: {date: '2026-10-07'}}];
  assert.deepEqual(orderedTasks(tasks).map(task => task.id), ['a', 'other', 'b']);
});
test('a newer successful queued field edit supersedes an older failed retry', async () => {
  let failures = []; const first = gate();
  const queue = createIntentQueue({changed(pending, current) {failures = current;}, failed() {}, async commit(ids, action) {
    if (action.patch.priority === 4) {await first.promise; throw new Error('known local failure');}
  }});
  const a = queue.submit(['a'], {kind: 'edit', patch: {priority: 4}}).catch(() => {});
  const b = queue.submit(['a'], {kind: 'edit', patch: {priority: 1}});
  first.resolve(); await Promise.all([a, b]); assert.deepEqual(failures, []);
});
