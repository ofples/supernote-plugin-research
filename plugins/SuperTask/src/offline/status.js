/** Small, safe status copy for pending offline work. Never return server bodies. */

function countsFrom(options) {
  const tasks = Number.isFinite(options.pendingTaskCount)
    ? Math.max(0, options.pendingTaskCount)
    : Math.max(0, Number(options.pendingCount) || 0);
  const collections = Math.max(0, Number(options.pendingCollectionCount) || 0);
  const explicitOther = Math.max(0, Number(options.pendingOtherCount) || 0);
  const total = Number.isFinite(options.pendingCount)
    ? Math.max(0, options.pendingCount)
    : tasks + collections + explicitOther;
  return {tasks, collections, other: explicitOther, total};
}

function classify(error) {
  if (!error) return null;
  const code = String(error.code || error.kind || error.type || '').toUpperCase();
  const message = typeof error === 'string' ? error : String(error.message || '');
  const status = Number(error.status || error.statusCode || error.httpStatus || message.match(/HTTP (\d{3})/)?.[1] || 0);

  if (status === 401 || /^(AUTH|UNAUTHORIZED|INVALID_TOKEN|TOKEN_INVALID)$/.test(code)) return 'auth';
  if (status === 403 || /^(PERMISSION|PERMISSION_DENIED|FORBIDDEN)$/.test(code) || /access is not allowed|permission is required/i.test(message)) return 'permission';
  if (status === 429 || /^(RATE_LIMIT|RATE_LIMITED|TOO_MANY_REQUESTS)$/.test(code)) return 'rate';
  if (status >= 500 || /^(SERVER|SERVER_ERROR|SERVICE_ERROR)$/.test(code)) return 'server';
  if (/^(OFFLINE|CONFIRMED_OFFLINE|NO_NETWORK|NETWORK_DISCONNECTED)$/.test(code) || error.isOffline === true) return 'offline';
  // Legacy transport strings do not prove the device has no Internet. Keep
  // them in the neutral reachability class instead of asserting offline.
  if (/network request failed|failed to fetch|could not connect|unreachable|timeout/i.test(message)) return 'reachability';
  return 'unknown';
}

function taskPhrase(count) {
  return `${count} ${count === 1 ? 'task' : 'tasks'}`;
}

function workPhrase(counts) {
  const parts = [];
  if (counts.tasks) parts.push(taskPhrase(counts.tasks));
  if (counts.collections) parts.push(`${counts.collections} ${counts.collections === 1 ? 'collection' : 'collections'}`);
  if (counts.other) parts.push(`${counts.other} other ${counts.other === 1 ? 'change' : 'changes'}`);
  if (!parts.length && counts.total) parts.push(`${counts.total} ${counts.total === 1 ? 'change' : 'changes'}`);
  return parts.join(' and ');
}

function savedVerb(counts) {
  return counts.total === 1 && counts.tasks + counts.collections + counts.other <= 1 ? 'is saved' : 'are saved';
}

/**
 * Returns short user-facing sync copy from structured errors and pending counts.
 * Supported counts: pendingCount (total), pendingTaskCount,
 * pendingCollectionCount, and pendingOtherCount.
 */
function syncStatusMessage(options = {}) {
  const counts = countsFrom(options);
  const work = workPhrase(counts);
  const category = classify(options.syncError);

  if (category === 'auth') return work ? `Sign in again to sync ${work}.` : 'Sign in again to sync.';
  if (category === 'permission') return work ? `Permission is needed to sync ${work}.` : 'Permission is needed to sync.';
  if (category === 'rate') return work ? `Todoist is limiting requests. ${work} will retry shortly.` : 'Todoist is limiting requests. Sync will retry shortly.';
  if (category === 'server') return work ? `Todoist is having trouble. ${work} ${savedVerb(counts)} and will retry.` : 'Todoist is having trouble. Sync will retry.';
  if (category === 'offline') return work ? `You're offline. Reconnect to sync ${work}.` : "You're offline.";
  if (category === 'reachability') return work ? `Can't reach Todoist right now. ${work} ${savedVerb(counts)} and will sync when service is reachable.` : "Can't reach Todoist right now.";
  if (category === 'unknown') return work ? `${work} ${savedVerb(counts)} and waiting to sync.` : 'Sync needs attention.';
  if (work) return `${work} waiting to sync.`;
  return '';
}

module.exports = {syncStatusMessage};
