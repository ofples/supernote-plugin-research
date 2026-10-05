const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createIntentQueue, projectTasks, composerDefaults} = require('../src/workspace/intents');
const {reorderProjection, projectContainers, projectContainerTasks} = require('../src/workspace/intents');
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
