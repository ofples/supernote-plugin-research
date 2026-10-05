import {NativeModules} from 'react-native';
import {PluginManager} from 'sn-plugin-lib';
import {loadConfig, getCachedConfig} from '../utils/config';
import {ensurePermissionGroup} from '../utils/permissions';
import {log} from '../utils/debug';
const model = require('./model');
const {createStore} = require('./store');
const {createSyncWorker} = require('./sync');
const {createTransport} = require('./transport');
const locations = require('./locations');
const bulk = require('./bulk');
const ordering = require('./order');

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
  return require('../cache/committedSnapshot.cjs').projectCommittedSnapshot(state, {warning: current.store.getWarning(), otherAccountStores: current.identity.otherAccountStores});
}

export async function saveOfflineBatch(drafts, source = null, capturedAt = Date.now(), request = {}) {
  const current = await offlineSession();
  bindRequest(current, request);
  if (!request.ids) {
    request.ids = JSON.parse(await NativeModules.TaskStorage.newIds(1 + drafts.length * 3));
  }
  const batchId = request.ids[0];
  const alreadySaved = Object.values((await current.store.load()).tasks).filter(task => task.batchId === batchId);
  assertCurrent(current);
  if (alreadySaved.length) {return alreadySaved.map(task => ({...task, syncState: 'pending'}));}
  let index = 0;
  const ids = () => {
    if (index >= request.ids.length) throw new Error('Capture changed after an uncertain save; reopen SuperTask to review saved tasks.');
    return request.ids[index++];
  };
  let created;
  await current.store.transaction(state => {
    bindRequest(current, request);
    const result = model.addBatch(state, drafts, source, ids, capturedAt);
    created = result.tasks;
    return result.next;
  });
  assertCurrent(current);
  requestActiveSync();
  return created.map(task => ({...task, syncState: 'pending'}));
}

export async function completeOffline(id, completed = true) {
  const current = await offlineSession();
  assertCurrent(current);
  const ids = await idGenerator(1);
  await current.store.transaction(state => {assertCurrent(current); return model.setCompleted(state, id, completed, ids);});
  assertCurrent(current);
  requestActiveSync();
}

export async function editOfflineTask(id, draft) {
  const current = await offlineSession();
  assertCurrent(current);
  const ids = await idGenerator(12);
  await current.store.transaction(state => {assertCurrent(current); return model.editTask(state, id, draft, ids);});
  assertCurrent(current);
  requestActiveSync();
  const state = await current.store.load(); assertCurrent(current);
  return model.cachedView(state, id);
}

export async function deleteOfflineTask(id) {
  const current = await offlineSession();
  assertCurrent(current);
  const ids = await idGenerator(12);
  await current.store.transaction(state => {assertCurrent(current); return model.deleteTask(state, id, ids);});
  assertCurrent(current);
  requestActiveSync();
}

export async function createOfflineCollection(projectId, name, request = {}) {
  return durableMutation(request, 16, (state, ids) => {
    const result = model.addCollection(state, projectId, name, ids);
    return {next: result.next, result: result.collection};
  }, ['collection_create', projectId, name]);
}

export async function cancelOfflineTask(id) {
  const current = await offlineSession();
  assertCurrent(current);
  await current.store.transaction(state => {assertCurrent(current); return model.cancelUnsent(state, id);});
  assertCurrent(current);
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
  return model.cachedView(state, id);
}

export async function rememberRemoteTask(task) {
  const current = await offlineSession();
  await current.store.transaction(state => model.rememberTask(state, task));
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
  return model.completedView(state);
}

export async function rememberCompleted(tasks) {
  const current = await offlineSession();
  await current.store.transaction(state => model.rememberCompleted(state, tasks));
}

async function mutationIdentity(request, count) {
  if (!request.ids) {request.ids = JSON.parse(await NativeModules.TaskStorage.newIds(count));}
  let index = 1;
  return {requestId: request.ids[0], ids: () => {
    if (index >= request.ids.length) {throw new Error('Mutation identity pool exhausted. Retain this request for retry.');}
    return request.ids[index++];
  }};
}
function assertCurrent(current) {
  if (getCachedConfig()?.apiToken?.trim() !== current.token) {const error = new Error('The Todoist account changed. This interaction was cancelled.'); error.code = 'ACCOUNT_CHANGED'; throw error;}
}
function bindRequest(current, request) {
  assertCurrent(current);
  if (request.accountKey && request.accountKey !== current.identity.accountKey) {
    const error = new Error('The Todoist account changed. Retry this saved interaction only with its original account.');
    error.code = 'ACCOUNT_CHANGED'; throw error;
  }
  request.accountKey = current.identity.accountKey;
}
async function durableMutation(request, count, reduce, operationSignature) {
  const current = await offlineSession(); bindRequest(current, request);
  const identity = await mutationIdentity(request, count); let result;
  const signature = JSON.stringify(operationSignature);
  assertCurrent(current);
  await current.store.transaction(state => {
    bindRequest(current, request);
    const prior = state.mutationRequests?.[identity.requestId];
    if (prior) {if (prior.signature !== signature) {throw new Error('An uncertain mutation identity cannot be reused for different changes.');} result = prior.result; return state;}
    const reduced = reduce(state, identity.ids); result = reduced.result;
    (reduced.next.mutationRequests ||= {})[identity.requestId] = {signature, result};
    return reduced.next;
  });
  assertCurrent(current); requestActiveSync(); return result;
}
export async function createOfflineProject(name, options = {}, request = {}) {
  return durableMutation(request, 16, (state, ids) => {
    const result = locations.createProject(state, name, ids, options);
    return {next: result.next, result: result.project};
  }, ['project_create', name, options]);
}
export async function renameOfflineProject(id, name, request = {}) {
  return durableMutation(request, 16, (state, ids) => ({next: locations.rename(state, 'project', id, name, ids), result: {id, name}}), ['project_rename', id, name]);
}
export async function renameOfflineCollection(id, name, request = {}) {
  return durableMutation(request, 16, (state, ids) => ({next: locations.rename(state, 'collection', id, name, ids), result: {id, name}}), ['collection_rename', id, name]);
}
export async function inspectOfflineContainer(kind, id) {
  if (!['project', 'collection'].includes(kind)) {throw new Error('Unsupported container type.');}
  const current = await offlineSession();
  return locations.scope(await current.store.load(), kind, id, model);
}
export async function verifyOfflineContainer(kind, id, options = {}) {
  const current = await offlineSession(); assertCurrent(current);
  const snapshot = await current.worker.verifyContainer(kind, id, options);
  assertCurrent(current); return snapshot;
}
export async function deleteOfflineContainer(kind, id, options, request = {}) {
  const current = await offlineSession(), plan = locations.scope(await current.store.load(), kind, id, model);
  return durableMutation(request, Math.max(32, plan.count * 6 + 16), (state, ids) => ({next: locations.remove(state, kind, id, options, ids, model), result: {id, kind, count: plan.count, mode: options.mode}}), ['container_delete', kind, id, options]);
}
export async function mutateOfflineTasks(taskIds, mutation, request = {}) {
  const current = await offlineSession(); bindRequest(current, request);
  const identity = await mutationIdentity(request, taskIds.length * 6 + 16); let results;
  assertCurrent(current);
  await current.store.transaction(state => {
    bindRequest(current, request);
    const reduced = bulk.mutate(state, taskIds, mutation, identity.ids, identity.requestId, model);
    results = reduced.results; return reduced.next;
  });
  assertCurrent(current); requestActiveSync(); return results;
}
export async function reorderOfflineTask(id, direction, request = {}) {
  return durableMutation(request, 16, (state, ids) => ({next: ordering.reorder(state, id, direction, ids, model), result: {id, direction}}), ['reorder', id, direction]);
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
