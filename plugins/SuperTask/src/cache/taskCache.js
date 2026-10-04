/** Private durable cache facade. Invalidating never deletes queued work. */
import {offlineData, subscribeOffline, syncOffline} from '../offline/service';
import {log} from '../utils/debug';
const model = require('../offline/model');
let cache = null;
let inflight = null;
let accountEpoch = 0;
const listeners = new Set();
function publish(data) {
  cache = data;
  for (const listener of listeners) { try { listener(data); } catch {} }
  return data;
}
subscribeOffline(state => {
  const allTasks = model.mergedTasks(state);
  const sections = model.mergedSections?.(state) || state.sections || [];
  publish({tasks: allTasks.filter(t => !t.completed && !t.deleted), allTasks, projects: state.projects, sections,
    timestamp: state.lastSync, pendingCount: state.outbox.length,
    pendingTaskCount: new Set(state.outbox.filter(op => op.kind !== 'collection_create').map(op => op.localId)).size,
    pendingCollectionCount: state.outbox.filter(op => op.kind === 'collection_create').length,
    pendingChanges: state.outbox.map(op => ({id: op.localId, uuid: op.uuid, kind: op.kind, state: op.state,
      error: op.error, task: state.tasks[op.localId], collection: sections.find(section => section.id === op.localId)})),
    syncNotices: state.syncNotices || [],
    errorCount: state.outbox.filter(op => op.state === 'attention').length, syncError: state.syncError,
    warning: cache?.warning, otherAccountStores: cache?.otherAccountStores});
});
export function subscribeCache(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function getCache() { return cache; }
export async function initTaskCache() {
  const epoch = accountEpoch;
  try {
    const data = await offlineData();
    return epoch === accountEpoch ? publish(data) : cache;
  }
  catch (error) { log('Cache', `Private cache unavailable: ${error.message}`); return null; }
}
export function fetchTaskData() {
  if (inflight) return inflight;
  const epoch = accountEpoch;
  const pending = syncOffline().then(data => {
    if (epoch !== accountEpoch) throw new Error('Configured account changed. Refresh the current account.');
    return publish(data);
  }).finally(() => { if (inflight === pending) inflight = null; });
  inflight = pending;
  return pending;
}
export function invalidateCache() { accountEpoch++; cache = null; inflight = null; initTaskCache(); }
