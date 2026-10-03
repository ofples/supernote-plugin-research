/** Private durable cache facade. Invalidating never deletes queued work. */
import {offlineData, subscribeOffline, syncOffline} from '../offline/service';
import {log} from '../utils/debug';
const {mergedTasks} = require('../offline/model');
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
  const allTasks = mergedTasks(state);
  publish({tasks: allTasks.filter(t => !t.completed), allTasks, projects: state.projects,
    timestamp: state.lastSync, pendingCount: state.outbox.length,
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
