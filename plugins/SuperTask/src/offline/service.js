import {NativeModules} from 'react-native';
import {PluginManager} from 'sn-plugin-lib';
import {loadConfig} from '../utils/config';
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
  const store = createStore(adapter, identity.accountKey, identity.deviceId, emit);
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
  return {tasks: model.mergedTasks(state), projects: state.projects, timestamp: state.lastSync,
    pendingCount: state.outbox.length, errorCount: state.outbox.filter(op => op.state === 'attention').length,
    syncError: state.syncError, warning: current.store.getWarning(),
    otherAccountStores: current.identity.otherAccountStores};
}

export async function saveOfflineBatch(drafts, source = null, capturedAt = Date.now()) {
  const current = await offlineSession();
  const ids = await idGenerator(1 + drafts.length * 3);
  let created;
  await current.store.transaction(state => {
    const result = model.addBatch(state, drafts, source, ids, capturedAt);
    created = result.tasks;
    return result.next;
  });
  return created;
}

export async function completeOffline(id, completed = true) {
  const current = await offlineSession();
  const ids = await idGenerator(1);
  await current.store.transaction(state => model.setCompleted(state, id, completed, ids));
}

export async function editOfflineTask(id, draft) {
  const current = await offlineSession();
  await current.store.transaction(state => model.editUnsent(state, id, draft));
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
    throw error;
  }
  return offlineData();
}
