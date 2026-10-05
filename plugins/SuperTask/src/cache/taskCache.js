/** Private durable cache facade. Invalidating never deletes queued work. */
import {offlineData, completedData, subscribeOffline, syncOffline} from '../offline/service';
import {log} from '../utils/debug';
const {projectCommittedSnapshot, shareSnapshot} = require('./committedSnapshot.cjs');
let cache = null;
let inflight = null;
let hydration = null;
let accountEpoch = 0;
let publicationSequence = 0;
let rawAccount = null;
let rawRevision = null;
const listeners = new Set();
function publish(data) {
  if (!data) {return cache;}
  if (data.accountKey && cache?.accountKey === data.accountKey && Number.isSafeInteger(data.revision) && Number.isSafeInteger(cache.revision) && data.revision < cache.revision) {return cache;}
  const shared = shareSnapshot(cache, data);
  cache = shared.snapshot;
  publicationSequence++;
  if (shared.changed) {for (const listener of listeners) {try {listener(cache);} catch { /* UI failures never affect the durable writer. */ }}}
  return cache;
}
subscribeOffline(state => {
  if (state.accountKey === rawAccount && state.revision === rawRevision) {return;}
  if (cache?.accountKey === state.accountKey && Number.isSafeInteger(cache.revision) && state.revision < cache.revision) {return;}
  if (cache?.accountKey && state.accountKey !== cache.accountKey) {
    accountEpoch++; cache = null; inflight = null; hydration = null;
  }
  rawAccount = state.accountKey; rawRevision = state.revision;
  publish(projectCommittedSnapshot(state, {warning: cache?.warning, otherAccountStores: cache?.otherAccountStores}));
});
export function subscribeCache(listener) {listeners.add(listener); return () => {listeners.delete(listener);};}
export function getCache() {return cache;}
/** Returns only complete, already committed workspace data; performs no reads. */
export function getCachedWorkspace(expectedAccountKey = null) {
  return cache && Array.isArray(cache.completedTasks) && (!expectedAccountKey || cache.accountKey === expectedAccountKey) ? cache : null;
}
async function completeSnapshot(data) {
  if (!Array.isArray(data?.completedTasks) && typeof completedData === 'function') {
    return {...data, completedTasks: await completedData()};
  }
  return data;
}
export function initTaskCache() {
  if (hydration) {return hydration;}
  const epoch = accountEpoch, sequence = publicationSequence;
  const pending = Promise.resolve().then(offlineData).then(completeSnapshot).then(data => {
    // A disk hydration must not repaint over a newer committed event, even
    // within the same account. Current UI intent remains outside this cache.
    return epoch === accountEpoch && sequence === publicationSequence ? publish(data) : cache;
  }).catch(error => {log('Cache', `Private cache unavailable: ${error.message}`); return null;})
    .finally(() => {if (hydration === pending) {hydration = null;}});
  hydration = pending;
  return pending;
}
export function fetchTaskData() {
  if (inflight) {return inflight;}
  const epoch = accountEpoch;
  const pending = syncOffline().then(completeSnapshot).then(data => {
    if (epoch !== accountEpoch) {throw new Error('Configured account changed. Refresh the current account.');}
    return publish(data);
  }).finally(() => {if (inflight === pending) {inflight = null;}});
  inflight = pending;
  return pending;
}
export function invalidateCache() {
  accountEpoch++; cache = null; inflight = null; hydration = null; rawAccount = null; rawRevision = null;
  initTaskCache();
}
