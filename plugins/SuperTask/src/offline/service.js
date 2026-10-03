import {NativeModules} from 'react-native';
import {PluginManager} from 'sn-plugin-lib';
import {loadConfig, getCachedConfig} from '../utils/config';
import {ensurePermissionGroup} from '../utils/permissions';
import {log} from '../utils/debug';
const model = require('./model');
const {createStore} = require('./store');
const {createSyncWorker} = require('./sync');
const {createTransport} = require('./transport');

let session = null;
let opening = Promise.resolve();
const listeners = new Set();

function emit(state) {
  for (const listener of listeners) {
    try { listener(state); } catch { /* keep the writer independent of UI */ }
  }
}

export function subscribeOffline(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function openSession() {
  const config = await loadConfig();
  const token = config.apiToken?.trim();
  if (!token) {throw new Error('Configure your Todoist token first. Offline tasks are kept separately for each configured token.');}
  if (session?.token === token) {return session;}
  const storage = NativeModules.TaskStorage;
  if (!storage) {throw new Error('Private task storage is missing. Install the complete updated SuperTask package.');}
  const dir = await PluginManager.getPluginDirPath();
  if (!dir) {throw new Error('PluginHost did not provide private storage. No task data was written to shared storage.');}
  const identity = JSON.parse(await storage.initialize(dir, token));
  const adapter = {
    async read() { return JSON.parse(await storage.read(identity.accountKey)); },
    commit: (next, previous) => storage.commit(identity.accountKey, next, previous),
  };
  const store = createStore(adapter, identity.accountKey, identity.deviceId, state => {
    if (getCachedConfig()?.apiToken?.trim() === token && session?.identity.accountKey === identity.accountKey) emit(state);
  });
  const api = createTransport(token, fetch, () => ensurePermissionGroup('sync'));
  const worker = createSyncWorker(store, api);
  await store.load(); // damaged data is an error, never an empty fallback
  session = {token, identity, store, worker};
  return session;
}

export function offlineSession() {
  const result = opening.then(openSession);
  opening = result.catch(() => {});
  return result;
}

async function idGenerator(count) {
  const values = JSON.parse(await NativeModules.TaskStorage.newIds(count));
  return () => {
    if (!values.length) {throw new Error('Task identity pool exhausted.');}
    return values.shift();
  };
}

export async function offlineData() {
  const current = await offlineSession();
  const state = await current.store.load();
  const allTasks = model.mergedTasks(state);
  return {tasks: allTasks.filter(task => !task.completed), allTasks, projects: state.projects, timestamp: state.lastSync,
    pendingCount: state.outbox.length, errorCount: state.outbox.filter(op => op.state === 'attention').length,
    syncError: state.syncError, warning: current.store.getWarning(),
    otherAccountStores: current.identity.otherAccountStores};
}

export async function saveOfflineBatch(drafts, source = null, capturedAt = Date.now(), request = {}) {
  const current = await offlineSession();
  if (!request.ids) {
    request.ids = JSON.parse(await NativeModules.TaskStorage.newIds(1 + drafts.length * 3));
  }
  const batchId = request.ids[0];
  const alreadySaved = Object.values((await current.store.load()).tasks).filter(task => task.batchId === batchId);
  if (alreadySaved.length) return alreadySaved.map(task => ({...task, syncState: 'pending'}));
  let index = 0;
  const ids = () => {
    if (index >= request.ids.length) throw new Error('Capture changed after an uncertain save; reopen SuperTask to review saved tasks.');
    return request.ids[index++];
  };
  let created;
  await current.store.transaction(state => {
    const result = model.addBatch(state, drafts, source, ids, capturedAt);
    created = result.tasks;
    return result.next;
  });
  requestActiveSync();
  return created.map(task => ({...task, syncState: 'pending'}));
}

export async function completeOffline(id, completed = true) {
  const current = await offlineSession();
  const ids = await idGenerator(1);
  await current.store.transaction(state => model.setCompleted(state, id, completed, ids));
  requestActiveSync();
}

export async function editOfflineTask(id, draft) {
  const current = await offlineSession();
  await current.store.transaction(state => model.editUnsent(state, id, draft));
  requestActiveSync();
}

export async function cancelOfflineTask(id) {
  const current = await offlineSession();
  await current.store.transaction(state => model.cancelUnsent(state, id));
}

export async function syncOffline() {
  const current = await offlineSession();
  try {
    await current.worker.sync();
  } catch (error) {
    log('Offline', `Sync deferred: ${error.message}`);
    await current.store.transaction(state => ({...state, syncError: error.message})).catch(() => {});
    throw error;
  }
  return offlineData();
}

export async function cachedTask(id) {
  const current = await offlineSession();
  const state = await current.store.load();
  const task = model.mergedTasks(state).find(t => t.id === id || t.remoteId === id) ||
    (state.completedRemote || []).find(t => t.id === id);
  return task || null;
}

export async function rememberRemoteTask(task) {
  const current = await offlineSession();
  await current.store.transaction(state => {
    const owned = Object.values(state.tasks).find(t => t.remoteId === task.id);
    if (owned && !state.outbox.some(op => op.localId === owned.id)) {
      const {id, remoteId, source, batchId, capturedAt} = owned;
      Object.assign(owned, task, {id, remoteId, source, batchId, capturedAt, remoteMissing: false});
    }
    state.remote = [...state.remote.filter(t => t.id !== task.id), task];
    return state;
  });
}
export async function retryOffline(id) {
  const current = await offlineSession();
  await current.store.transaction(state => {
    for (const op of state.outbox.filter(item => item.localId === id)) {
      // An explicit retry reuses the frozen command UUID and payload.
      op.state = 'pending'; op.retryAt = 0; op.error = null;
    }
    return state;
  });
  requestActiveSync();
}

export async function completedData() {
  const current = await offlineSession();
  const state = await current.store.load();
  const owned = model.mergedTasks(state);
  const remoteIds = new Set(owned.map(t => t.remoteId || t.id));
  return [...(state.completedRemote || []).filter(t => !remoteIds.has(t.id)), ...owned.filter(t => t.completed)];
}

export async function rememberCompleted(tasks) {
  const current = await offlineSession();
  await current.store.transaction(state => ({...state, completedRemote: tasks}));
}

export async function forgetRemoteTask(id) {
  const current = await offlineSession();
  await current.store.transaction(state => {
    const task = model.findTask(state, id);
    if (task) delete state.tasks[task.id];
    state.remote = state.remote.filter(t => t.id !== (task?.remoteId || id));
    state.completedRemote = (state.completedRemote || []).filter(t => t.id !== (task?.remoteId || id));
    return state;
  });
}

let foreground = false;
let poll = null;
let lastAttempt = 0;
export function requestActiveSync() {
  if (!foreground) return;
  lastAttempt = Date.now();
  syncOffline().catch(() => {});
}
export function setOfflineForeground(active) {
  foreground = active;
  if (poll) clearInterval(poll);
  poll = null;
  if (!active) return;
  requestActiveSync();
  // Event-free RN host: a bounded foreground-only poll notices Wi-Fi returning.
  // It is stopped on close; no promise of execution while plugins are closed.
  poll = setInterval(() => {
    if (Date.now() - lastAttempt >= 30000) requestActiveSync();
  }, 30000);
}
