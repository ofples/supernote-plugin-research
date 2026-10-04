const {test} = require('node:test');
const assert = require('node:assert/strict');
const m = require('../src/offline/model');
let number = 0; const ids = () => `identity-${++number}`;
const remote = {id: 'real', content: 'Scratch', priority: 1, project_id: 'p', labels: [], completed: false};
function owned() {const state = m.emptyStore('account', 'device'); state.remote = [remote]; return m.editTask(state, 'real', {content: 'Local'}, ids);}
test('remembered reads preserve queued overlays and refresh ordinary remote baselines together', () => {
  const state = owned(), local = Object.values(state.tasks)[0];
  const stillQueued = m.rememberTask(state, {...remote, content: 'External'});
  assert.equal(stillQueued.tasks[local.id].content, 'Local'); assert.equal(stillQueued.tasks[local.id].baseRemote.content, 'Scratch');
  state.outbox = []; const refreshed = m.rememberTask(state, {...remote, content: 'External'});
  assert.equal(refreshed.tasks[local.id].content, 'External'); assert.equal(refreshed.tasks[local.id].baseRemote.content, 'External');
});
test('remembered stale acknowledgement cannot roll back accepted local changes', () => {
  let state = owned(); state = m.markSending(state, state.outbox);
  const localId = Object.keys(state.tasks)[0], operation = state.outbox[0];
  state = m.acknowledge(state, state.outbox, {sync_status: {[operation.uuid]: 'ok'}}, 100);
  state = m.rememberTask(state, remote);
  assert.equal(state.tasks[localId].content, 'Local'); assert.equal(state.tasks[localId].baseRemote.content, 'Local');
});
test('completed history normalizes checked:false and cannot redisplay deleted tasks or an active recurring series', () => {
  let state = owned(); state = m.deleteTask(state, 'real', ids);
  state.completedRemote = [{...remote, checked: false, completed_at: '2026-10-04'}, {id: 'history', content: 'Older', checked: false}];
  assert.equal(m.cachedView(state, 'real'), null);
  assert.deepEqual(m.completedView(state).map(task => [task.id, task.completed]), [['history', true]]);
  assert.equal(m.cachedView(state, 'history').completed, true);
  const active = m.emptyStore('account', 'device'); active.remote = [remote]; active.completedRemote = [{...remote, checked: false}];
  assert.equal(m.completedView(active).length, 0);
});
test('legacy checked:false history can be reopened without premarking an active task', () => {
  const state = m.emptyStore('account', 'device'); state.completedRemote = [{...remote, checked: false}];
  const reopened = m.setCompleted(state, 'real', false, ids);
  assert.equal(reopened.outbox[0].kind, 'reopen');
  assert.equal(Object.values(reopened.tasks)[0].completed, false);
});
test('unknown commit after failed recovery remains uncertain to the form', async () => {
  const {createStore} = require('../src/offline/store');
  let reads = 0;
  const store = createStore({read: async () => {if (++reads > 1) throw new Error('Disk cannot be read'); return {exists: false};},
    commit: async () => {throw new Error('Lost native response');}}, 'account', 'device');
  await assert.rejects(store.transaction(state => m.addBatch(state, [{content: 'Scratch'}], null, ids).next), error => error.uncertainCommit === true);
});
