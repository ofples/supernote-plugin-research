/**
 * Todoist API v1 client
 *
 * All task CRUD operations go through here. Uses the device's
 * fetch() which works on Supernote without restrictions.
 */

import {ensurePermissionGroup} from '../utils/permissions';
import {log} from '../utils/debug';
import {offlineData, saveOfflineBatch, completeOffline, cachedTask, rememberRemoteTask, editOfflineTask, deleteOfflineTask, completedData, rememberCompleted} from '../offline/service';

const TODOIST_API = 'https://api.todoist.com/api/v1';

// Without a timeout, a request that stalls mid-flight (wifi drop) leaves the
// awaiting caller hung forever -- and anything holding a guard flag or dedup
// promise on it stays locked for the life of the process (B-022).
const FETCH_TIMEOUT_MS = 20000;

let _configLoader = null;

export function setConfigLoader(loader) {
  _configLoader = loader;
}

/**
 * fetch() with an abort timeout. RN's fetch buffers the full response body
 * natively, so only the request itself can hang -- body reads resolve from
 * memory and don't need their own deadline.
 */
async function fetchWithTimeout(url, options = {}, ms = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {...options, signal: controller.signal});
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error(`Request timed out after ${ms}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function todoistFetch(path, options = {}) {
  if (!_configLoader) {
    throw new Error('Config loader not set. Call setConfigLoader first.');
  }

  log('API', `Loading config...`);
  const config = await _configLoader();
  if (!config.apiToken) {
    throw new Error('No Todoist token yet. Tap Settings, then the Setup tab, to add one.');
  }

  // Chauvet 3.29.44: INTERNET is asked for here, in context, the first time
  // tasks sync -- not at launch. A denial is reported as what it is.
  if (!(await ensurePermissionGroup('sync'))) {
    throw new Error('Todoist access not allowed on this device. Open Settings > Setup > Permissions and allow "Sync with Todoist".');
  }

  const url = `${TODOIST_API}${path}`;
  const method = options.method || 'GET';
  log('API', `${method} ${url}`);

  const maxRetries = 2;
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = attempt * 1500;
      log('API', `Retry ${attempt}/${maxRetries} after ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }

    let response;
    try {
      response = await fetchWithTimeout(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });
    } catch (e) {
      // Timeouts and network drops are retryable, same as 5xx
      lastError = e;
      log('API', `Request failed: ${e.message}`);
      if (attempt < maxRetries) continue;
      throw lastError;
    }

    log('API', `Response: ${response.status}`);

    // Retry on 5xx server errors
    if (response.status >= 500) {
      lastError = new Error(`Todoist request failed (HTTP ${response.status}).`);
      lastError.status = response.status;
      if (attempt < maxRetries) continue;
      throw lastError;
    }

    // 429: honor Retry-After (capped) instead of failing outright
    if (response.status === 429) {
      lastError = new Error('Todoist request failed (HTTP 429).');
      lastError.status = 429;
      if (attempt < maxRetries) {
        const retryAfter = parseInt(response.headers?.get?.('retry-after') || '0', 10) || 0;
        const wait = Math.min(Math.max(retryAfter * 1000, 2000), 15000);
        log('API', `Rate limited; waiting ${wait}ms (Retry-After: ${retryAfter || 'n/a'})`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw lastError;
    }

    if (!response.ok) {
      const error = new Error(`Todoist request failed (HTTP ${response.status}).`);
      error.status = response.status;
      throw error;
    }

    if (response.status === 204) return null;
    return response.json();
  }

  throw lastError;
}

/**
 * Extract array from paginated API response.
 * v1 API returns {results: [...], next_cursor: "..."} or bare arrays.
 */
function unwrapResult(result) {
  if (Array.isArray(result)) return result;
  if (result && typeof result === 'object') {
    if (Array.isArray(result.results)) return result.results;
    if (Array.isArray(result.items)) return result.items;
    if (Array.isArray(result.tasks)) return result.tasks;
  }
  log('API', `unwrapResult: unexpected format, returning empty array`);
  return [];
}

/**
 * Fetch all pages for a paginated endpoint.
 */
async function fetchAllPages(path, params = '') {
  const MAX_PAGES = 20; // safety ceiling: ~1000 items; a misbehaving cursor must not loop forever
  let allItems = [];
  let cursor = null;
  let pages = 0;

  do {
    if (++pages > MAX_PAGES) {
      log('API', `Pagination CAPPED at ${MAX_PAGES} pages (${allItems.length} items) -- results truncated`);
      break;
    }
    const sep = params || cursor ? '?' : '';
    const cursorParam = cursor ? `cursor=${encodeURIComponent(cursor)}` : '';
    const joinChar = params && cursorParam ? '&' : '';
    const url = `${path}${sep}${params}${joinChar}${cursorParam}`;

    const result = await todoistFetch(url);
    const items = unwrapResult(result);
    allItems = allItems.concat(items);

    cursor = result && typeof result === 'object' ? result.next_cursor : null;
    if (cursor) {
      log('API', `Pagination: got ${items.length} items, next cursor: ${cursor}`);
    }
  } while (cursor);

  return allItems;
}

export async function getTask(taskId) {
  const cached = await cachedTask(taskId);
  if (cached) return cached;
  if (taskId.startsWith('local:')) throw new Error('This local task is not in the current account queue.');
  const task = await todoistFetch(`/tasks/${encodeURIComponent(taskId)}`);
  await rememberRemoteTask(task);
  return task;
}

export async function getTasks(filter) {
  if (filter) throw new Error('Arbitrary Todoist filters are not supported offline. Use the local views.');
  return (await offlineData()).tasks;
}

export async function getTasksByProject(projectId) {
  return (await offlineData()).tasks.filter(task => task.project_id === projectId);
}

export async function getProjects() { return (await offlineData()).projects; }

/** @param {Object} parameters */
export async function createTask(parameters) {
  const {source = null, capturedAt = Date.now(), request = {}, ...draft} = parameters;
  return (await saveOfflineBatch([draft], source, capturedAt, request))[0];
}

export async function updateTask(taskId, changes) {
  const task = await getTask(taskId);
  const data = await offlineData();
  const patch = require('../offline/taskPatch').taskPatch(task, changes, data.projects, data.sections);
  return Object.keys(patch).length ? editOfflineTask(taskId, patch) : task;
}

export async function completeTask(taskId) {
  await getTask(taskId);
  await completeOffline(taskId, true);
}

export async function reopenTask(taskId) {
  await getTask(taskId);
  await completeOffline(taskId, false);
}

/**
 * Completed tasks from the last N days (v1 unified API, paginated).
 * Items carry completed_at plus the usual task fields.
 */
async function fetchCompletedTasks(days = 30) {
  const until = new Date();
  const since = new Date(until.getTime() - days * 86400000);
  const params =
    `since=${encodeURIComponent(since.toISOString())}` +
    `&until=${encodeURIComponent(until.toISOString())}`;
  const items = await fetchAllPages('/tasks/completed/by_completion_date', params);
  log('API', `getCompletedTasks(${days}d): ${items.length} tasks`);
  return items;
}

export async function getCompletedTasks(days = 30) {
  const cached = await completedData();
  return cached;
}
export async function refreshCompletedTasks(days = 30) {
  const tasks = await fetchCompletedTasks(days);
  await rememberCompleted(tasks);
  return completedData();
}

export async function deleteTask(taskId) {
  await getTask(taskId);
  await deleteOfflineTask(taskId);
}

export async function testConnection() {
  log('API', 'Testing connection...');
  const projects = await fetchAllPages('/projects');
  const tasks = await fetchAllPages('/tasks');
  return {
    ok: true,
    projectCount: projects?.length ?? 0,
    taskCount: tasks?.length ?? 0,
  };
}
