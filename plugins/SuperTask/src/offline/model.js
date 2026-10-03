/* Pure, host-independent task/outbox model. Never mutate a committed generation. */
const SCHEMA = 1;
const clone = value => JSON.parse(JSON.stringify(value));

function emptyStore(accountKey, deviceId) {
  return {schema: SCHEMA, accountKey, deviceId, revision: 0, userId: null,
    lastSync: null, projects: [], remote: [], completedRemote: [], tasks: {}, outbox: [], syncError: null};
}

function validateStore(store, accountKey, deviceId) {
  if (!store || store.schema !== SCHEMA || store.accountKey !== accountKey ||
      store.deviceId !== deviceId || !Number.isSafeInteger(store.revision) ||
      store.revision < 0 || !Array.isArray(store.remote) ||
      !Array.isArray(store.projects) || !Array.isArray(store.outbox) ||
      (store.completedRemote !== undefined && !Array.isArray(store.completedRemote)) ||
      !store.tasks || Array.isArray(store.tasks) || typeof store.tasks !== 'object') {
    throw new Error('Unsupported, damaged, or differently bound task store. Existing data was not overwritten.');
  }
  const ids = new Set();
  for (const op of store.outbox) {
    if (!op || typeof op.uuid !== 'string' || !op.uuid || ids.has(op.uuid) ||
        !['create', 'complete', 'reopen'].includes(op.kind) ||
        !['pending', 'sending', 'attention'].includes(op.state) ||
        !store.tasks[op.localId] || typeof op.attempts !== 'number' ||
        (op.attempts > 0 && !op.command)) {
      throw new Error('Damaged task queue. Existing data was not overwritten.');
    }
    ids.add(op.uuid);
  }
  for (const [id, task] of Object.entries(store.tasks)) {
    if (!task || task.id !== id || typeof task.content !== 'string' || !task.content.trim()) {
      throw new Error('Damaged task data. Existing data was not overwritten.');
    }
  }
  return store;
}

function localDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Accept calendar dates and the two explicit relative shortcuts. Never send a
// deferred natural-language due string that could change meaning during sync.
function resolveDue(value, capturedAt = Date.now()) {
  if (!value) {return null;}
  const text = String(value).trim().toLowerCase();
  if (text === 'today' || text === 'tomorrow') {
    const date = new Date(capturedAt);
    if (text === 'tomorrow') {date.setDate(date.getDate() + 1);}
    return {date: localDate(date), is_recurring: false};
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const date = new Date(text + 'T12:00:00');
    if (!Number.isNaN(date.getTime()) && localDate(date) === text) {
      return {date: text, is_recurring: false};
    }
  }
  throw new Error('Choose a calendar date, today, or tomorrow before saving offline.');
}

function normalizeDraft(draft, capturedAt) {
  const content = String(draft.content || '').trim();
  if (!content) {throw new Error('Every selected task needs a title.');}
  const priority = draft.priority || 1;
  if (![1, 2, 3, 4].includes(priority)) {throw new Error('Invalid task priority.');}
  return {content, description: String(draft.description || ''),
    project_id: draft.projectId || draft.project_id || null,
    section_id: draft.sectionId || draft.section_id || null,
    labels: Array.isArray(draft.labels) ? draft.labels.map(String) : [], priority,
    due: draft.due || resolveDue(draft.dueString, capturedAt)};
}

function addBatch(store, drafts, source, ids, capturedAt = Date.now()) {
  if (!drafts.length) {throw new Error('Select at least one task.');}
  // Validate the complete batch before changing anything.
  const values = drafts.map(draft => normalizeDraft(draft, capturedAt));
  const next = clone(store);
  const batchId = ids();
  const tasks = values.map(value => {
    const id = `local:${ids()}`;
    const task = {...value, id, remoteId: null, completed: false, batchId,
      capturedAt, source: source ? {filePath: source.filePath || source.notePath,
        pageNum: source.pageNum ?? 0, bounds: source.bounds || null} : null};
    next.tasks[id] = task;
    next.outbox.push({uuid: ids(), tempId: ids(), kind: 'create', localId: id,
      state: 'pending', attempts: 0, retryAt: 0, error: null, command: null});
    return task;
  });
  return {next, tasks};
}

function findTask(store, id) {
  return store.tasks[id] || Object.values(store.tasks).find(t => t.remoteId === id) ||
    store.remote.find(t => t.id === id);
}

function setCompleted(store, id, completed, ids) {
  const next = clone(store);
  let task = findTask(next, id);
  if (!task) {throw new Error('Task is not cached. Refresh while online first.');}
  if (task.due?.is_recurring) {
    throw new Error('Recurring tasks need an online completion; offline recurrence changes are not supported.');
  }
  const localId = next.tasks[task.id] ? task.id : `remote:${task.id}`;
  if (!next.tasks[localId]) {
    next.tasks[localId] = {...task, id: localId, remoteId: task.id, source: null,
      completed: Boolean(task.completed || task.is_completed || task.checked),
      serverCompleted: Boolean(task.completed || task.is_completed || task.checked)};
  }
  task = next.tasks[localId];
  // Coalesce only operations which have never been sent. A potentially accepted
  // completion must be resolved before the later reopen can be sent.
  const pending = next.outbox.filter(op => op.localId === localId && op.kind !== 'create');
  const unsent = pending.filter(op => op.attempts === 0);
  const preceding = pending.filter(op => op.attempts > 0);
  if (Boolean(task.completed) === completed && !unsent.length) {return next;}
  next.outbox = next.outbox.filter(op => !unsent.includes(op));
  const create = next.outbox.find(op => op.localId === localId && op.kind === 'create');
  const known = preceding.length ? preceding[preceding.length - 1].kind === 'complete' :
    create ? false : Boolean(task.serverCompleted ?? task.completed);
  task.completed = completed;
  if (known !== completed) {
    next.outbox.push({uuid: ids(), kind: completed ? 'complete' : 'reopen', localId,
      state: 'pending', attempts: 0, retryAt: 0, error: null, command: null});
  }
  return next;
}

function editUnsent(store, id, draft, capturedAt = Date.now()) {
  const next = clone(store);
  const create = next.outbox.find(op => op.localId === id && op.kind === 'create');
  if (!create || create.attempts !== 0) {
    throw new Error('This task may already be on Todoist. Resolve its sync before editing.');
  }
  Object.assign(next.tasks[id], normalizeDraft(draft, capturedAt));
  return next;
}

function cancelUnsent(store, id) {
  const next = clone(store);
  const ops = next.outbox.filter(op => op.localId === id);
  if (!ops.some(op => op.kind === 'create') || ops.some(op => op.attempts > 0)) {
    throw new Error('This task may already be on Todoist. Resolve its sync before removing it.');
  }
  next.outbox = next.outbox.filter(op => op.localId !== id);
  delete next.tasks[id];
  return next;
}

function readyOperations(store, now = Date.now()) {
  const seen = new Set();
  return store.outbox.filter(op => {
    if (seen.has(op.localId)) {return false;}
    seen.add(op.localId); // An attention/backoff dependency also blocks later ops.
    return op.state !== 'attention' && op.retryAt <= now &&
      (op.kind === 'create' || store.tasks[op.localId].remoteId);
  }).slice(0, 50);
}

function commandFor(store, op) {
  if (op.command) {return clone(op.command);}
  const task = store.tasks[op.localId];
  if (op.kind === 'create') {
    const args = {content: task.content, description: task.description, priority: task.priority, labels: task.labels};
    if (task.project_id) {args.project_id = task.project_id;}
    if (task.section_id) {args.section_id = task.section_id;}
    if (task.due) {args.due = {date: task.due.date};}
    return {type: 'item_add', uuid: op.uuid, temp_id: op.tempId, args};
  }
  if (!task.remoteId) {throw new Error('Task creation must be acknowledged first.');}
  return {type: op.kind === 'complete' ? 'item_complete' : 'item_uncomplete',
    uuid: op.uuid, args: {id: task.remoteId}};
}

function markSending(store, operations) {
  const next = clone(store);
  const selected = new Set(operations.map(op => op.uuid));
  for (const op of next.outbox) {
    if (!selected.has(op.uuid)) {continue;}
    op.command = commandFor(next, op);
    op.state = 'sending';
    op.attempts++;
  }
  return next;
}

function acknowledge(store, operations, response, now = Date.now()) {
  const next = clone(store);
  const selected = new Set(operations.map(op => op.uuid));
  const accepted = new Set();
  for (const op of next.outbox) {
    if (!selected.has(op.uuid)) {continue;}
    const status = response?.sync_status?.[op.uuid];
    const task = next.tasks[op.localId];
    if (status === 'ok') {
      if (op.kind === 'create') {
        const remoteId = response.temp_id_mapping?.[op.tempId];
        if (typeof remoteId !== 'string' || !remoteId) {
          // Replay SAME identity; never recreate because a mapping is absent.
          op.state = 'pending';
          op.retryAt = now + 30000;
          op.error = 'Todoist acknowledged creation without its ID mapping. Retry will reconcile the same command.';
          continue;
        }
        task.remoteId = remoteId;
        task.serverCompleted = false;
      } else {
        task.serverCompleted = op.kind === 'complete';
      }
      accepted.add(op.uuid);
    } else if (status && typeof status === 'object') {
      const code = status.http_code;
      op.state = code === 429 || code >= 500 ? 'pending' : 'attention';
      op.retryAt = now + 30000;
      op.error = status.error || status.error_tag || 'Todoist rejected this command.';
    } else {
      op.state = 'pending';
      op.retryAt = now + 30000;
      op.error = 'No command acknowledgement. Retrying the same identity is safe.';
    }
  }
  next.outbox = next.outbox.filter(op => !accepted.has(op.uuid));
  return next;
}

function failOperations(store, operations, error, now = Date.now()) {
  const next = clone(store);
  const selected = new Set(operations.map(op => op.uuid));
  for (const op of next.outbox) {
    if (!selected.has(op.uuid)) {continue;}
    op.state = error.status && error.status >= 400 && error.status < 500 && error.status !== 429 ? 'attention' : 'pending';
    op.error = error.message || 'Network unavailable.';
    const delay = error.retryAfterMs || Math.min(300000, 5000 * 2 ** Math.min(op.attempts, 6));
    op.retryAt = now + delay;
  }
  next.syncError = error.message || 'Network unavailable.';
  return next;
}

function replaceRemote(store, remote, projects, now = Date.now()) {
  if (!Array.isArray(remote) || !Array.isArray(projects)) {throw new Error('Invalid remote snapshot.');}
  const next = clone(store);
  next.remote = remote;
  next.projects = projects;
  next.lastSync = now;
  next.syncError = null;
  // Retain source references and recently acknowledged tasks even when REST
  // reads lag behind the write. Pending overlays always win over fetches.
  for (const task of Object.values(next.tasks)) {
    if (next.outbox.some(op => op.localId === task.id)) {continue;}
    const latest = remote.find(item => item.id === task.remoteId);
    if (latest) {
      const {id, remoteId, source, batchId, capturedAt} = task;
      Object.assign(task, latest, {id, remoteId, source, batchId, capturedAt,
        completed: Boolean(latest.is_completed || latest.checked), serverCompleted: Boolean(latest.is_completed || latest.checked)});
      task.remoteMissing = false;
    } else if (task.remoteId) {
      // Sync full snapshots are authoritative for active items. Keep the source
      // record for navigation/history but do not resurrect a remotely removed task.
      task.remoteMissing = true;
    }
  }
  return next;
}

function mergedTasks(store) {
  const owned = new Set(Object.values(store.tasks).map(t => t.remoteId).filter(Boolean));
  return [...store.remote.filter(t => !owned.has(t.id)).map(t => ({...t, completed: Boolean(t.is_completed || t.checked), syncState: 'synced'})),
    ...Object.values(store.tasks).filter(t => !t.remoteMissing || t.completed || store.outbox.some(op => op.localId === t.id)).map(t => {
      const ops = store.outbox.filter(op => op.localId === t.id);
      return {...clone(t), syncState: ops.some(op => op.state === 'attention') ? 'attention' : ops.length ? 'pending' : 'synced',
        syncError: ops.find(op => op.error)?.error || null};
    })];
}

function snapshot(store) {
  // Explicit allowlist: no token, account fingerprint, command payload or notes
  // descriptions. These task titles and backlinks may still be sensitive.
  return {schema: SCHEMA, revision: store.revision, publishedAt: Date.now(), lastSync: store.lastSync,
    pendingCount: store.outbox.length, errorCount: store.outbox.filter(op => op.state === 'attention').length,
    syncError: store.syncError, projects: store.projects.map(p => ({id: p.id, name: p.name})),
    tasks: mergedTasks(store).map(t => ({id: t.id, content: t.content, project_id: t.project_id,
      labels: t.labels || [], priority: t.priority || 1, due: t.due || null, completed: !!t.completed,
      source: t.source || null, syncState: t.syncState}))};
}

module.exports = {SCHEMA, clone, emptyStore, validateStore, resolveDue, localDate,
  addBatch, findTask, setCompleted, editUnsent, cancelUnsent, readyOperations,
  commandFor, markSending, acknowledge, failOperations, replaceRemote, mergedTasks, snapshot};
