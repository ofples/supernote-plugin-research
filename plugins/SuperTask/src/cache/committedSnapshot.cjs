/* eslint-env es2020 */
/* Canonical presentation of a committed private generation. No native I/O. */
const model = require('../offline/model');
const locations = require('../offline/locations');
const completed = task => Boolean(task.completed ?? task.is_completed ?? task.checked);
function locationFor(state, kind, id) {
  const owned = kind === 'project' ? state.localProjects || {} : state.collections || {};
  const remote = kind === 'project' ? state.projects : state.sections || [];
  return owned[id] || Object.values(owned).find(value => value.remoteId === id) || remote.find(value => value.id === id) || null;
}
function projectCommittedSnapshot(state, metadata = {}) {
  // privateTasks already merges ownership and synchronized sibling ordering.
  // Reuse that projection instead of running mergedTasks three times for active,
  // private and completed presentation.
  const allTasks = model.privateTasks(state);
  const visible = allTasks.filter(task => !task.deleted && !task.is_deleted);
  const tasks = visible.filter(task => !completed(task) && !task.remoteMissing);
  const suppressed = new Set([
    ...Object.values(state.tasks).map(task => task.remoteId || task.id),
    ...state.remote.filter(task => !completed(task) && !task.is_deleted).map(task => task.id),
  ]);
  const completedTasks = [
    ...(state.completedRemote || []).filter(task => !suppressed.has(task.id)).map(task => ({...task, completed: true, is_completed: true, occurrenceHistory: true})),
    ...visible.filter(completed),
  ];
  const outbox = state.outbox;
  return {accountKey: state.accountKey, revision: state.revision,
    tasks, allTasks, completedTasks, projects: locations.mergedProjects(state), sections: model.mergedSections(state),
    timestamp: state.lastSync, pendingCount: outbox.length,
    pendingTaskCount: new Set(outbox.filter(op => !locations.locationKind(op)).map(op => op.localId)).size,
    pendingCollectionCount: outbox.filter(op => op.kind.startsWith('collection_')).length,
    pendingProjectCount: outbox.filter(op => op.kind.startsWith('project_')).length,
    pendingOtherCount: outbox.filter(op => op.kind.startsWith('project_')).length,
    pendingChanges: outbox.map(op => ({id: op.localId, uuid: op.uuid, kind: op.kind, state: op.state,
      attempts: op.attempts, occurrenceKey: op.occurrenceKey || null, error: op.error, task: state.tasks[op.localId],
      project: op.kind.startsWith('project_') ? locationFor(state, 'project', op.localId) : null,
      collection: op.kind.startsWith('collection_') ? locationFor(state, 'collection', op.localId) : null})),
    syncNotices: state.syncNotices || [], errorCount: outbox.filter(op => op.state === 'attention').length,
    syncError: state.syncError, warning: metadata.warning, otherAccountStores: metadata.otherAccountStores};
}
function equalValue(a, b) {
  if (a === b) {return true;}
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) {return false;}
  const aKeys = Object.keys(a), bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {return false;}
  return aKeys.every(key => Object.prototype.hasOwnProperty.call(b, key) && equalValue(a[key], b[key]));
}
function recordKey(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {return null;}
  const identity = value.uuid || value.localId || value.remoteId || value.id;
  return identity ? `${identity}|${value.occurrenceKey || value.completed_at || ''}` : null;
}
function shareValue(previous, next) {
  if (previous === next) {return previous;}
  if (!previous || !next || typeof previous !== 'object' || typeof next !== 'object' || Array.isArray(previous) !== Array.isArray(next)) {return next;}
  if (Array.isArray(next)) {
    const keyed = new Map(), ambiguous = new Set();
    for (const value of previous) {
      const key = recordKey(value);
      if (key) {if (keyed.has(key)) {ambiguous.add(key);} keyed.set(key, value);}
    }
    let same = previous.length === next.length;
    const result = next.map((value, index) => {
      const key = recordKey(value), candidate = key && !ambiguous.has(key) ? keyed.get(key) : previous[index];
      const shared = shareValue(candidate, value);
      if (shared !== previous[index]) {same = false;}
      return shared;
    });
    return same ? previous : result;
  }
  const keys = Object.keys(next); let same = keys.length === Object.keys(previous).length;
  const result = {};
  for (const key of keys) {
    result[key] = shareValue(previous[key], next[key]);
    if (!Object.prototype.hasOwnProperty.call(previous, key) || result[key] !== previous[key]) {same = false;}
  }
  return same ? previous : result;
}
function shareSnapshot(previous, next) {
  if (!previous || !next || previous.accountKey !== next.accountKey) {return {snapshot: next, changed: true};}
  const result = {...next}; let changed = false;
  // Revision is a writer generation, not a visible change. Keep it accurate in
  // cache while avoiding a listener event for a semantic no-op transaction.
  for (const key of Object.keys(next)) {
    if (key === 'revision') {continue;}
    result[key] = shareValue(previous[key], next[key]);
    if (!Object.prototype.hasOwnProperty.call(previous, key) || result[key] !== previous[key]) {changed = true;}
  }
  if (Object.keys(previous).some(key => key !== 'revision' && !Object.prototype.hasOwnProperty.call(next, key))) {changed = true;}
  return {snapshot: !changed && previous.revision === next.revision ? previous : result, changed};
}
module.exports = {projectCommittedSnapshot, equalValue, shareSnapshot};
