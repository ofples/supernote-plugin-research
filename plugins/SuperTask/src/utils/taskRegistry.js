/** Source references live in the same private generation as tasks and outbox. */
import RNFS from 'react-native-fs';
import {PluginManager} from 'sn-plugin-lib';
import {offlineSession, offlineData} from '../offline/service';
const {findTask} = require('../offline/model');
const LEGACY = '/storage/emulated/0/MyStyle/SuperTask/task-registry.json';
let imported = null;
let importing = null;

async function importVerifiedSources() {
  const current = await offlineSession();
  if (imported === current.identity.accountKey) return;
  const state = await current.store.load();
  if (!state.userId || !state.lastSync) return;
  if (await PluginManager.hasPermission('plugin.permission.FILE:READ') !== 1) return;
  if (!(await RNFS.exists(LEGACY))) { imported = current.identity.accountKey; return; }
  const legacy = JSON.parse(await RNFS.readFile(LEGACY, 'utf8'));
  if (!legacy?.tasks || typeof legacy.tasks !== 'object') throw new Error('Legacy task references are damaged; original file retained.');
  const verifiedIds = new Set(state.remote.map(task => task.id));
  await current.store.transaction(next => {
    for (const [id, reference] of Object.entries(legacy.tasks)) {
      if (!verifiedIds.has(id) || findTask(next, id)?.source || !reference.notePath) continue;
      const task = next.remote.find(item => item.id === id);
      next.tasks[id] = {...task, id, remoteId: id, completed: false, serverCompleted: false,
        source: {filePath: reference.notePath, pageNum: reference.pageNum ?? 0, bounds: null}};
    }
    return next;
  });
  imported = current.identity.accountKey;
}
function migrateVerifiedSources() {
  if (!importing) importing = importVerifiedSources().finally(() => {importing = null;});
  return importing;
}

function asReference(task) {
  return {...task, notePath: task.source.filePath,
    noteFile: task.source.filePath.split('/').pop(), pageNum: task.source.pageNum,
    createdAt: task.capturedAt ? new Date(task.capturedAt).toISOString() : null};
}
export async function getAllTasks() {
  await migrateVerifiedSources();
  return (await offlineData()).allTasks.filter(task => task.source?.filePath).map(asReference);
}
export async function getTask(id) { return (await getAllTasks()).find(task => task.id === id || task.remoteId === id) || null; }
export async function getTasksForNote(name) {
  return (await getAllTasks()).filter(task => name.startsWith('/') ? task.notePath === name : task.noteFile === name);
}
export async function getTasksForPage(name, page) { return (await getTasksForNote(name)).filter(task => task.pageNum === page); }
export async function addTask(id, {notePath, pageNum, noteFile, content}) {
  if (!notePath) return;
  const current = await offlineSession();
  await current.store.transaction(state => {
    const task = findTask(state, id);
    if (!task) throw new Error('Task was not saved; source reference was not written.');
    if (!state.tasks[task.id]) state.tasks[task.id] = {...task, remoteId: task.id};
    state.tasks[task.id].source = {filePath: notePath, pageNum: pageNum ?? 0, bounds: null};
    return state;
  });
}
export async function updateTaskNote(id, {notePath}) {
  if (!notePath) return;
  const current = await offlineSession();
  await current.store.transaction(state => {
    const task = findTask(state, id);
    if (task?.source) task.source.filePath = notePath;
    return state;
  });
}
// Completion is already persisted by the API facade; registry reads reflect it.
export async function markCompleted(id, completed = true) {}
// Online deletion removes the authoritative task in the API facade. Never prune
// a private queue merely because an active-only network list lacks its task.
export async function removeTask(id) {}
export async function setLastSync() {}
export function invalidateCache() { imported = null; }
export async function updateTaskId() { throw new Error('Local source IDs remain stable across synchronization.'); }
