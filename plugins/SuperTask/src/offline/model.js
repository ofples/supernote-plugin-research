/* Pure task/outbox model. Mutations never change a committed generation. */
const SCHEMA = 2;
const clone = value => JSON.parse(JSON.stringify(value));
const completed = t => Boolean(t.completed ?? t.is_completed ?? t.checked);
const kinds = ['create', 'complete', 'reopen', 'update', 'move', 'delete', 'collection_create', 'recurring_complete'];
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function remoteState(t) {
  if (!t) {return null;}
  const due = t.due ? {date: t.due.datetime || t.due.date, is_recurring: !!t.due.is_recurring,
    ...(t.due.is_recurring ? {string: t.due.string || '', timezone: t.due.timezone || null, lang: t.due.lang || null} : {})} : null;
  return {content: t.content || '', description: t.description || '', project_id: t.project_id || null,
    section_id: t.section_id || null, parent_id: t.parent_id || null, labels: [...(t.labels || [])].sort(),
    priority: t.priority || 1, due, completed: completed(t), deleted: !!t.is_deleted};
}
function emptyStore(accountKey, deviceId) {
  return {schema: SCHEMA, accountKey, deviceId, revision: 0, userId: null, lastSync: null,
    projects: [], sections: [], collections: {}, remote: [], completedRemote: [], tasks: {}, outbox: [],
    syncError: null, syncNotices: [], conflictArchive: []};
}
function validateStore(store, accountKey, deviceId) {
  if (!store || ![1, SCHEMA].includes(store.schema) || store.accountKey !== accountKey || store.deviceId !== deviceId ||
      !Number.isSafeInteger(store.revision) || store.revision < 0 || !Array.isArray(store.remote) ||
      !Array.isArray(store.projects) || !Array.isArray(store.outbox) ||
      (store.completedRemote !== undefined && !Array.isArray(store.completedRemote)) ||
      (store.sections !== undefined && !Array.isArray(store.sections)) ||
      !store.tasks || Array.isArray(store.tasks) || typeof store.tasks !== 'object' ||
      (store.schema === SCHEMA && (!store.collections || Array.isArray(store.collections) || typeof store.collections !== 'object' ||
        !Array.isArray(store.syncNotices) || !Array.isArray(store.conflictArchive)))) {
    throw new Error('Unsupported, damaged, or differently bound task store. Existing data was not overwritten.');
  }
  const ids = new Set();
  for (const op of store.outbox) {
    if (!op || typeof op.uuid !== 'string' || !op.uuid || ids.has(op.uuid) ||
        !(store.schema === 1 ? ['create', 'complete', 'reopen'] : kinds).includes(op.kind) ||
        !['pending', 'sending', 'attention'].includes(op.state) ||
        !(op.kind === 'collection_create' ? store.collections?.[op.localId] : store.tasks[op.localId]) ||
        !Number.isSafeInteger(op.attempts) || op.attempts < 0 || (op.attempts > 0 && !op.command) ||
        (['update', 'move'].includes(op.kind) && (!op.patch || typeof op.patch !== 'object' || Array.isArray(op.patch)))) {
      throw new Error('Damaged task queue. Existing data was not overwritten.');
    }
    ids.add(op.uuid);
  }
  for (const [id, task] of Object.entries(store.tasks)) {
    if (!task || task.id !== id || typeof task.content !== 'string' || !task.content.trim()) {
      throw new Error('Damaged task data. Existing data was not overwritten.');
    }
  }
  for (const [id, section] of Object.entries(store.collections || {})) {
    if (!section || section.id !== id || typeof section.name !== 'string' || !section.name.trim() || !section.project_id) {
      throw new Error('Damaged collection data. Existing data was not overwritten.');
    }
  }
  return store;
}
function migrateStore(store) {
  const next = clone(store);
  if (next.schema === SCHEMA) {return next;}
  next.schema = SCHEMA; next.sections ||= []; next.completedRemote ||= [];
  next.collections = {}; next.syncNotices = []; next.conflictArchive = [];
  for (const task of Object.values(next.tasks)) {
    const cached = [...next.remote, ...next.completedRemote].find(t => t.id === task.remoteId);
    if (cached) {task.baseRemote = remoteState(cached);}
    else if (task.remoteId && !next.outbox.some(op => op.localId === task.id)) {task.baseRemote = remoteState({...task, completed: task.serverCompleted ?? task.completed});}
    // A legacy overlay with no saved baseline cannot safely prove no conflict.
  }
  return next;
}
function localDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function resolveDue(value, capturedAt = Date.now()) {
  if (!value) {return null;}
  const text = String(value).trim().toLowerCase();
  if (text === 'today' || text === 'tomorrow') {
    const date = new Date(capturedAt); if (text === 'tomorrow') {date.setDate(date.getDate() + 1);}
    return {date: localDate(date), is_recurring: false};
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const date = new Date(text + 'T12:00:00');
    if (!Number.isNaN(date.getTime()) && localDate(date) === text) {return {date: text, is_recurring: false};}
  }
  throw new Error('Choose a calendar date, today, or tomorrow before saving offline.');
}
function normalizeDraft(draft, capturedAt) {
  const content = String(draft.content || '').trim();
  if (!content) {throw new Error('Every selected task needs a title.');}
  const priority = draft.priority || 1;
  if (![1, 2, 3, 4].includes(priority)) {throw new Error('Invalid task priority.');}
  return {content, description: String(draft.description || ''), project_id: draft.projectId || draft.project_id || null,
    section_id: draft.sectionId || draft.section_id || null, labels: Array.isArray(draft.labels) ? draft.labels.map(String) : [], priority,
    due: own(draft, 'due') && draft.due !== undefined ? clone(draft.due) : resolveDue(draft.dueString, capturedAt)};
}
function mergedSections(store) {
  const local = Object.values(store.collections || {}), owned = new Set(local.map(s => s.remoteId).filter(Boolean));
  return [...(store.sections || []).filter(s => !owned.has(s.id)), ...local.map(s => ({...clone(s), id: s.remoteId || s.id, localId: s.id,
    is_deleted: !!s.remoteUnavailable,
    syncState: store.outbox.find(op => op.localId === s.id)?.state === 'attention' ? 'attention' : s.remoteId ? 'synced' : 'pending'}))];
}
function validateLocation(store, projectId, sectionId) {
  require('../collections/model').validateLocation(projectId, sectionId, mergedSections(store));
}
function operation(ids, kind, localId, extra = {}) {
  return {uuid: ids(), kind, localId, state: 'pending', attempts: 0, retryAt: 0, error: null, command: null, ...extra};
}
function addBatch(store, drafts, source, ids, capturedAt = Date.now()) {
  if (!drafts.length) {throw new Error('Select at least one task.');}
  const values = drafts.map(draft => normalizeDraft(draft, capturedAt));
  values.forEach(value => {if (value.section_id) {value.section_id = mappedSectionId(store, value.section_id);}});
  values.forEach(v => validateLocation(store, v.project_id, v.section_id));
  const next = clone(store), batchId = ids();
  const tasks = values.map(value => {
    const id = `local:${ids()}`;
    const task = {...value, id, remoteId: null, completed: false, batchId, capturedAt,
      source: source ? {filePath: source.filePath || source.notePath, pageNum: source.pageNum ?? 0, bounds: source.bounds || null} : null};
    next.tasks[id] = task;
    next.outbox.push(operation(ids, 'create', id, {tempId: ids()}));
    return task;
  });
  return {next, tasks};
}
function findTask(store, id) {
  const active = store.tasks[id] || Object.values(store.tasks).find(t => t.remoteId === id) || store.remote.find(t => t.id === id);
  if (active) {return active;}
  const history = (store.completedRemote || []).find(t => t.id === id);
  return history ? {...history, completed: true, is_completed: true, occurrenceHistory: true} : null;
}
function ownTask(store, id) {
  let task = findTask(store, id);
  if (!task) {throw new Error('Task is not cached. Refresh while online first.');}
  if (!store.tasks[task.id]) {
    const localId = `remote:${task.id}`;
    store.tasks[localId] = {...task, id: localId, remoteId: task.id, source: task.source || null,
      completed: completed(task), serverCompleted: completed(task), baseRemote: remoteState(task)};
    task = store.tasks[localId];
  }
  if (!task.baseRemote && task.remoteId && !store.outbox.some(op => op.localId === task.id)) {task.baseRemote = remoteState(task);}
  return task;
}
function editTask(store, id, patch, ids, capturedAt = Date.now()) {
  const next = clone(store), task = ownTask(next, id);
  if (task.deleted) {throw new Error('This task is deleted locally. Resolve its deletion before editing.');}
  const values = {};
  for (const key of ['content', 'description', 'priority', 'labels', 'due', 'project_id', 'section_id']) {
    if (own(patch, key) && patch[key] !== undefined) {values[key] = clone(patch[key]);}
  }
  if (own(patch, 'projectId')) {values.project_id = patch.projectId;}
  if (own(patch, 'sectionId')) {values.section_id = patch.sectionId;}
  if (own(patch, 'dueString')) {values.due = resolveDue(patch.dueString, capturedAt);}
  if (own(values, 'content')) {values.content = String(values.content || '').trim(); if (!values.content) {throw new Error('Every task needs a title.');}}
  if (own(values, 'description')) {values.description = String(values.description || '');}
  if (own(values, 'priority') && ![1, 2, 3, 4].includes(values.priority)) {throw new Error('Invalid task priority.');}
  if (own(values, 'labels')) {if (!Array.isArray(values.labels)) {throw new Error('Invalid task labels.');} values.labels = values.labels.map(String);}
  if (values.due !== undefined && values.due !== null) {
    if (typeof values.due !== 'object' || !values.due.date) {throw new Error('Choose a calendar date before saving offline.');}
    if (!values.due.is_recurring) {values.due = resolveDue(values.due.date, capturedAt);}
  }
  if (own(values, 'project_id')) {
    values.project_id ||= next.projects.find(p => p.inbox_project || p.is_inbox_project)?.id || null;
    if (values.project_id !== task.project_id && !own(values, 'section_id')) {values.section_id = null;}
  }
  if (values.section_id) {values.section_id = mappedSectionId(next, values.section_id);}
  const projectId = own(values, 'project_id') ? values.project_id : task.project_id;
  const sectionId = own(values, 'section_id') ? values.section_id : task.section_id;
  validateLocation(next, projectId, sectionId);
  if ((own(values, 'project_id') || own(values, 'section_id')) && !projectId && (task.project_id || sectionId)) {throw new Error('Refresh projects before choosing Inbox.');}
  const changed = Object.fromEntries(Object.entries(values).filter(([k, v]) => !same(task[k] ?? null, v ?? null)));
  if (!Object.keys(changed).length) {return next;}
  task.remoteMissing = false;
  Object.assign(task, changed);
  const create = next.outbox.find(op => op.localId === task.id && op.kind === 'create');
  if (create && create.attempts === 0) {return next;}
  const update = Object.fromEntries(Object.entries(changed).filter(([k]) => !['project_id', 'section_id'].includes(k)));
  const append = (kind, body) => {
    const ops = next.outbox.filter(op => op.localId === task.id);
    let barrier = -1;
    ops.forEach((op, index) => {if (op.attempts > 0 || !['update', 'move'].includes(op.kind)) {barrier = index;}});
    const tail = ops.slice(barrier + 1).find(op => op.kind === kind);
    const expected = clone(task.baseRemote || {});
    for (const prior of ops.slice(0, barrier + 1)) {
      if (prior.kind === 'create' && prior.command) {Object.assign(expected, prior.command.args);}
      if (prior.kind === 'update') {Object.assign(expected, prior.command?.args || prior.patch);}
      if (prior.kind === 'move') {Object.assign(expected, prior.patch);}
    }
    const combined = {...(tail?.patch || {}), ...body};
    for (const [key, value] of Object.entries(combined)) {
      const normalized = key === 'due' ? remoteState({due: value}).due : key === 'labels' ? [...value].sort() : value;
      if (same(normalized ?? null, expected[key] ?? null)) {delete combined[key];}
    }
    if (kind === 'move' && Object.keys(combined).length) {Object.assign(combined, {project_id: projectId, section_id: sectionId || null});}
    if (!Object.keys(combined).length) {if (tail) {next.outbox = next.outbox.filter(op => op !== tail);} return;}
    if (tail) {tail.patch = combined; tail.command = null; tail.state = 'pending'; tail.retryAt = 0; tail.error = null;}
    else {next.outbox.push(operation(ids, kind, task.id, {patch: combined}));}
  };
  if (Object.keys(update).length) {append('update', update);}
  if (own(changed, 'project_id') || own(changed, 'section_id')) {append('move', {project_id: projectId, section_id: sectionId || null});}
  return next;
}
function deleteTask(store, id, ids) {
  const next = clone(store), task = ownTask(next, id);
  const ops = next.outbox.filter(op => op.localId === task.id);
  if (ops.some(op => op.kind === 'create') && ops.every(op => op.attempts === 0)) {
    next.outbox = next.outbox.filter(op => op.localId !== task.id); delete next.tasks[task.id]; return next;
  }
  if (task.deleted) {return next;}
  next.outbox = next.outbox.filter(op => op.localId !== task.id || op.attempts > 0);
  task.deleted = true; next.outbox.push(operation(ids, 'delete', task.id)); return next;
}
function addCollection(store, projectId, name, ids) {
  const next = clone(store), title = String(name || '').trim();
  if (!title) {throw new Error('Enter a collection name.');}
  if (!next.projects.some(p => p.id === projectId && !p.is_deleted && !p.is_archived)) {throw new Error('This project is unavailable. Refresh projects before creating a collection.');}
  const existing = mergedSections(next).find(s => s.project_id === projectId && s.name.trim().toLowerCase() === title.toLowerCase());
  if (existing) {const error = new Error('A collection with this name already exists. Choose the existing collection.'); error.existingCollection = existing; throw error;}
  const id = `section:${ids()}`, collection = {id, remoteId: null, project_id: projectId, name: title};
  next.collections[id] = collection;
  next.outbox.push(operation(ids, 'collection_create', id, {tempId: ids()}));
  return {next, collection: {...collection, syncState: 'pending'}};
}
function setCompleted(store, id, done, ids, capturedAt = Date.now()) {
  const next = clone(store), task = ownTask(next, id);
  if (task.deleted) {throw new Error('This task is deleted locally.');}
  const recurring = !!task.due?.is_recurring;
  const ops = next.outbox.filter(op => op.localId === task.id);
  const completions = ops.filter(op => ['complete', 'reopen', 'recurring_complete'].includes(op.kind));
  const occurrence = completions.find(op => op.kind === 'recurring_complete');
  if ((recurring || occurrence || task.awaitingRecurrence) && !done) {
    if (!occurrence || occurrence.attempts > 0 || task.awaitingRecurrence) {
      const error = new Error('Recurring completion can only be undone before it is sent. Refresh the next occurrence after sync.');
      error.code = 'RECURRING_UNDO_UNSUPPORTED'; throw error;
    }
    next.outbox = next.outbox.filter(op => op !== occurrence); task.completed = false; task.occurrencePending = false; return next;
  }
  if (done && (task.occurrencePending || task.awaitingRecurrence)) {return next;}
  const unsent = completions.filter(op => op.attempts === 0), preceding = completions.filter(op => op.attempts > 0);
  if (Boolean(task.completed) === done && !unsent.length) {return next;}
  task.remoteMissing = false;
  next.outbox = next.outbox.filter(op => !unsent.includes(op));
  const create = ops.find(op => op.kind === 'create');
  const known = preceding.length ? preceding[preceding.length - 1].kind !== 'reopen' : create ? false : Boolean(task.serverCompleted ?? task.completed);
  task.completed = done;
  if (known !== done) {
    const extra = recurring ? {occurrence: clone(task.due), completedAt: new Date(capturedAt).toISOString()} : {};
    next.outbox.push(operation(ids, recurring ? 'recurring_complete' : done ? 'complete' : 'reopen', task.id, extra));
    if (recurring) {task.occurrencePending = true; task.occurrenceCompletedAt = extra.completedAt;}
  }
  return next;
}
// Legacy wrappers deliberately retain their narrowly safe cancellation contract.
function editUnsent(store, id, draft, capturedAt = Date.now()) {
  const create = store.outbox.find(op => op.localId === id && op.kind === 'create');
  if (!create || create.attempts !== 0) {throw new Error('This task may already be on Todoist. Resolve its sync before editing.');}
  return editTask(store, id, draft, () => {throw new Error('Unexpected edit identity');}, capturedAt);
}
function cancelUnsent(store, id) {
  const ops = store.outbox.filter(op => op.localId === id);
  if (!ops.some(op => op.kind === 'create') || ops.some(op => op.attempts > 0)) {throw new Error('This task may already be on Todoist. Resolve its sync before removing it.');}
  return deleteTask(store, id, () => {throw new Error('Unexpected deletion identity');});
}
function mappedSectionId(store, id) {return store.collections?.[id]?.remoteId || id;}
function checkDestinations(store) {
  const next = clone(store);
  for (const op of next.outbox) {
    if (op.attempts || !['create', 'move', 'collection_create'].includes(op.kind)) {continue;}
    const destination = op.kind === 'collection_create' ? next.collections[op.localId] : op.kind === 'move' ? op.patch : next.tasks[op.localId];
    const projectId = destination.project_id, section = destination.section_id;
    let error;
    if (projectId && !next.projects.some(p => p.id === projectId && !p.is_deleted && !p.is_archived)) {error = 'The destination project is unavailable. Choose an available project, then retry.';}
    else {
      try {validateLocation(next, projectId, section);}
      catch {error = 'The destination collection is unavailable. Choose an available collection or No collection, then retry.';}
    }
    if (error) {op.state = 'attention'; op.error = error;}
  }
  return next;
}
function readyOperations(store, now = Date.now()) {
  const seen = new Set();
  return store.outbox.filter(op => {
    if (seen.has(op.localId)) {return false;}
    seen.add(op.localId);
    if (op.state === 'attention' || op.retryAt > now) {return false;}
    if (op.command) {return true;}
    if (op.kind === 'collection_create') {return true;}
    const task = store.tasks[op.localId], destination = op.kind === 'move' ? op.patch.section_id : op.kind === 'create' ? task.section_id : null;
    if (destination && store.collections?.[destination] && !store.collections[destination].remoteId) {return false;}
    return op.kind === 'create' || !!task.remoteId;
  }).slice(0, 50);
}
function commandFor(store, op) {
  if (op.command) {return clone(op.command);}
  if (op.kind === 'collection_create') {const s = store.collections[op.localId]; return {type: 'section_add', uuid: op.uuid, temp_id: op.tempId, args: {name: s.name, project_id: s.project_id}};}
  const task = store.tasks[op.localId];
  if (op.kind === 'create') {
    const args = {content: task.content, description: task.description, priority: task.priority, labels: task.labels};
    if (task.project_id) {args.project_id = task.project_id;}
    if (task.section_id) {args.section_id = mappedSectionId(store, task.section_id);}
    if (task.due) {args.due = clone(task.due);}
    return {type: 'item_add', uuid: op.uuid, temp_id: op.tempId, args};
  }
  if (!task.remoteId) {throw new Error('Task creation must be acknowledged first.');}
  if (op.kind === 'update') {return {type: 'item_update', uuid: op.uuid, args: {id: task.remoteId, ...clone(op.patch)}};}
  if (op.kind === 'move') {return {type: 'item_move', uuid: op.uuid, args: {id: task.remoteId, ...(op.patch.section_id ? {section_id: mappedSectionId(store, op.patch.section_id)} : {project_id: op.patch.project_id})}};}
  return {type: ({complete: 'item_complete', reopen: 'item_uncomplete', delete: 'item_delete', recurring_complete: 'item_close'})[op.kind], uuid: op.uuid, args: {id: task.remoteId}};
}
function markSending(store, operations) {
  const next = clone(store), selected = new Set(operations.map(op => op.uuid));
  for (const op of readyOperations(next, Infinity)) {if (selected.has(op.uuid)) {
    op.command = commandFor(next, op); op.state = 'sending'; op.attempts++;
  }}
  return next;
}
function applyRemote(task, remote) {
  const {id, remoteId, source, batchId, capturedAt} = task;
  Object.assign(task, remote, {id, remoteId, source, batchId, capturedAt, completed: completed(remote), serverCompleted: completed(remote),
    baseRemote: remoteState(remote), remoteMissing: false, deleted: !!remote.is_deleted, occurrencePending: false, awaitingRecurrence: false});
}
function preflight(store, operationId, result, now = Date.now()) {
  const next = clone(store), op = next.outbox.find(o => o.uuid === operationId);
  if (!op || op.attempts || ['create', 'collection_create'].includes(op.kind)) {return next;}
  const task = next.tasks[op.localId];
  if (!result || result.status === 'unavailable' || result.status === 'missing') {
    op.state = 'attention'; op.error = 'This task is unavailable in the active list. Refresh completed tasks or restore access before retrying; no deletion was assumed.'; return next;
  }
  const remote = result.task || result, latest = remoteState(remote);
  if (!task.baseRemote) {op.state = 'attention'; op.error = 'This older queued change has no remote baseline. Refresh the task before retrying.'; return next;}
  if (!same(latest, task.baseRemote)) {
    const unsent = next.outbox.filter(o => o.localId === task.id && o.attempts === 0);
    next.conflictArchive.push({localId: task.id, at: now, desired: clone(task), operations: clone(unsent)});
    next.syncNotices.push({localId: task.id, at: now, message: 'A task changed on Todoist. The Todoist version was kept.'});
    next.outbox = next.outbox.filter(o => !unsent.includes(o)); applyRemote(task, remote);
    next.remote = [...next.remote.filter(t => t.id !== task.remoteId), ...(latest.deleted || latest.completed ? [] : [remote])];
    if (latest.completed) {next.completedRemote = [...(next.completedRemote || []).filter(t => t.id !== task.remoteId), remote];}
  }
  return next;
}
function acknowledge(store, operations, response, now = Date.now()) {
  const next = clone(store), selected = new Set(operations.map(op => op.uuid)), accepted = new Set();
  for (const op of next.outbox) {
    if (!selected.has(op.uuid)) {continue;}
    const status = response?.sync_status?.[op.uuid];
    const task = op.kind === 'collection_create' ? next.collections[op.localId] : next.tasks[op.localId];
    if (status === 'ok') {
      if (['create', 'collection_create'].includes(op.kind)) {
        const remoteId = response.temp_id_mapping?.[op.tempId];
        if (typeof remoteId !== 'string' || !remoteId) {op.state = 'pending'; op.retryAt = now + 30000; op.error = 'Todoist acknowledged creation without its ID mapping. Retry will reconcile the same command.'; continue;}
        task.remoteId = remoteId;
        if (op.kind === 'collection_create') {
          for (const t of Object.values(next.tasks)) {if (t.section_id === op.localId) {t.section_id = remoteId;}}
          for (const dependent of next.outbox) {if (!dependent.attempts && dependent.patch?.section_id === op.localId) {dependent.patch.section_id = remoteId;}}
        } else {task.serverCompleted = false; task.baseRemote = remoteState({...op.command?.args || task, completed: false}); task.acknowledgedCreate = true;}
      } else {
        const base = task.baseRemote || remoteState(task);
        if (op.kind === 'update') {Object.assign(base, remoteState({...base, ...op.command.args, completed: base.completed}));}
        if (op.kind === 'move') {base.project_id = op.patch.project_id; base.section_id = mappedSectionId(next, op.patch.section_id) || null; base.parent_id = null;}
        if (['complete', 'reopen'].includes(op.kind)) {task.serverCompleted = op.kind === 'complete'; base.completed = task.serverCompleted;}
        if (op.kind === 'delete') {task.deleted = true; task.deleteAcknowledged = true; base.deleted = true;}
        if (op.kind === 'recurring_complete') {task.serverCompleted = false; task.awaitingRecurrence = true; task.occurrencePending = true; task.completed = true;}
        task.baseRemote = base;
      }
      task.acknowledgedAt = now; accepted.add(op.uuid);
      if (op.kind !== 'collection_create') {task.remoteMissing = false;}
      if (op.kind !== 'collection_create' && op.kind !== 'delete') {task.ackPendingRefresh = true;}
    } else if (status && typeof status === 'object') {
      op.state = status.http_code === 429 || status.http_code >= 500 ? 'pending' : 'attention';
      op.retryAt = now + 30000; op.error = status.http_code === 429 ? 'Todoist rate limited synchronization. Retry later.' : 'Todoist rejected this change. Check the task and destination, then retry.';
    } else {op.state = 'pending'; op.retryAt = now + 30000; op.error = 'No command acknowledgement. Retrying the same identity is safe.';}
  }
  next.outbox = next.outbox.filter(op => !accepted.has(op.uuid)); return next;
}
function reconcileAcknowledged(store, localId, result) {
  const next = clone(store), task = next.tasks[localId];
  if (!task || task.deleted || !result || result.status === 'missing' || result.status === 'unavailable') {return next;}
  const remote = result.task || result;
  task.remoteMissing = false;
  const oldBase = task.baseRemote, latest = remoteState(remote);
  // Do not roll the expected state back to a stale post-write read. The next
  // preflight compares against the acknowledged command, not an older cache.
  if (!task.awaitingRecurrence && !task.acknowledgedCreate && oldBase && !same(latest, oldBase)) {
    const sameWithResolvedInbox = !oldBase.project_id && same({...latest, project_id: null}, oldBase);
    if (!sameWithResolvedInbox) {return next;}
  }
  if (task.awaitingRecurrence && same(latest.due, oldBase?.due)) {return next;}
  task.baseRemote = latest;
  task.acknowledgedCreate = false;
  task.ackPendingRefresh = false;
  if (!next.outbox.some(op => op.localId === localId)) {
    applyRemote(task, remote);
  } else if (task.awaitingRecurrence) {
    if (!next.outbox.some(op => op.localId === localId && op.kind === 'update' && own(op.patch, 'due'))) {task.due = clone(remote.due);}
    task.completed = false; task.serverCompleted = false; task.awaitingRecurrence = false; task.occurrencePending = false;
  }
  return next;
}
function failOperations(store, operations, error, now = Date.now()) {
  const next = clone(store), selected = new Set(operations.map(op => op.uuid));
  for (const op of next.outbox) {if (selected.has(op.uuid)) {
    op.state = error.status >= 400 && error.status < 500 && error.status !== 429 ? 'attention' : 'pending';
    op.error = error.message || 'Cannot reach Todoist. Changes remain saved locally.';
    op.retryAt = now + (error.retryAfterMs || Math.min(300000, 5000 * 2 ** Math.min(op.attempts, 6)));
  }}
  next.syncError = error.message || 'Cannot reach Todoist. Changes remain saved locally.'; return next;
}
function rememberTask(store, remote) {
  let next = clone(store);
  const owned = Object.values(next.tasks).find(task => task.remoteId === remote.id);
  next.remote = [...next.remote.filter(task => task.id !== remote.id), remote];
  if (owned) {owned.remoteMissing = false;}
  if (owned && !owned.deleted && !next.outbox.some(op => op.localId === owned.id)) {
    if (owned.ackPendingRefresh || owned.acknowledgedCreate || owned.awaitingRecurrence) {
      next = reconcileAcknowledged(next, owned.id, {status: 'found', task: remote});
    } else {applyRemote(owned, remote);}
  }
  return next;
}
function replaceRemote(store, remote, projects, now = Date.now(), sections = store.sections || []) {
  // This replaces a complete active snapshot. Transport rejects partial Sync
  // responses before the worker calls it; individual reads use rememberTask.
  if (!Array.isArray(remote) || !Array.isArray(projects) || !Array.isArray(sections)) {throw new Error('Invalid remote snapshot.');}
  const next = clone(store); next.remote = remote; next.projects = projects; next.sections = sections; next.lastSync = now; next.syncError = null;
  for (const collection of Object.values(next.collections || {})) {
    if (!collection.remoteId) {continue;}
    const latest = sections.find(section => section.id === collection.remoteId && !section.is_deleted && !section.is_archived);
    collection.remoteUnavailable = !latest;
    if (latest) {collection.name = latest.name; collection.project_id = latest.project_id;}
  }
  for (const task of Object.values(next.tasks)) {
    const latest = remote.find(t => t.id === task.remoteId);
    const pending = next.outbox.some(op => op.localId === task.id);
    if (latest || pending || !task.remoteId || task.acknowledgedCreate || task.ackPendingRefresh || task.awaitingRecurrence) {
      task.remoteMissing = false;
    } else if (!task.deleted) {
      // Absence cannot distinguish completed, deleted or inaccessible. Keep
      // the record and baseline, but stop advertising it as a known active task.
      task.remoteMissing = true;
    }
    if (task.deleted || pending) {continue;}
    if (latest) {
      if (task.ackPendingRefresh && !task.acknowledgedCreate && !same(remoteState(latest), task.baseRemote) && !task.awaitingRecurrence) {continue;}
      if (task.awaitingRecurrence && same(remoteState(latest).due, task.baseRemote?.due)) {continue;}
      applyRemote(task, latest);
      task.acknowledgedCreate = false;
      task.ackPendingRefresh = false;
    }
  }
  return next;
}
function rememberCompleted(store, history) {
  const next = clone(store);
  next.completedRemote = history.map(task => ({...task, completed: true, is_completed: true, occurrenceHistory: true}));
  for (const task of Object.values(next.tasks)) {
    if (task.deleted || task.acknowledgedCreate || task.ackPendingRefresh || task.awaitingRecurrence ||
        next.outbox.some(op => op.localId === task.id) ||
        next.remote.some(remote => remote.id === task.remoteId && !completed(remote) && !remote.is_deleted)) {continue;}
    const found = next.completedRemote.find(remote => remote.id === task.remoteId);
    if (found) {applyRemote(task, found);}
  }
  return next;
}
function mergedTasks(store, {includeRemoteMissing = false} = {}) {
  const owned = new Set(Object.values(store.tasks).map(t => t.remoteId).filter(Boolean));
  return [...store.remote.filter(t => !owned.has(t.id) && !t.is_deleted).map(t => ({...t, completed: completed(t), syncState: 'synced'})),
    ...Object.values(store.tasks).filter(t => !t.deleted && !t.is_deleted &&
      (includeRemoteMissing || !t.remoteMissing || completed(t) || t.acknowledgedCreate || t.ackPendingRefresh || t.awaitingRecurrence ||
        store.outbox.some(op => op.localId === t.id))).map(t => {
      const ops = store.outbox.filter(op => op.localId === t.id);
      return {...clone(t), syncState: ops.some(op => op.state === 'attention') ? 'attention' : ops.length || t.awaitingRecurrence ? 'pending' : 'synced', syncError: ops.find(op => op.error)?.error || null};
    })];
}
function cachedView(store, id) {
  const owned = Object.values(store.tasks).find(task => task.id === id || task.remoteId === id);
  if (owned?.deleted || owned?.is_deleted) {return null;}
  return mergedTasks(store, {includeRemoteMissing: true}).find(task => task.id === id || task.remoteId === id) ||
    (store.completedRemote || []).map(task => ({...task, completed: true, is_completed: true, occurrenceHistory: true})).find(task => task.id === id) || null;
}
function privateTasks(store) {
  const tasks = mergedTasks(store, {includeRemoteMissing: true});
  const ids = new Set(tasks.map(task => task.id));
  // Registry recovery must see missing records and deletion tombstones too.
  return [...tasks, ...Object.values(store.tasks).filter(task => !ids.has(task.id)).map(clone)];
}
function completedView(store) {
  const owned = mergedTasks(store);
  const suppressed = new Set([...Object.values(store.tasks).map(task => task.remoteId || task.id),
    ...store.remote.filter(task => !completed(task) && !task.is_deleted).map(task => task.id)]);
  return [...(store.completedRemote || []).filter(task => !suppressed.has(task.id)).map(task => ({...task, completed: true, is_completed: true, occurrenceHistory: true})),
    ...owned.filter(task => task.completed)];
}
function snapshot(store) {
  return {schema: 1, revision: store.revision, publishedAt: Date.now(), lastSync: store.lastSync,
    pendingCount: store.outbox.length, errorCount: store.outbox.filter(op => op.state === 'attention').length,
    syncError: store.syncError, projects: store.projects.map(p => ({id: p.id, name: p.name})),
    tasks: mergedTasks(store).map(t => ({id: t.id, content: t.content, project_id: t.project_id, labels: t.labels || [], priority: t.priority || 1,
      due: t.due || null, completed: !!t.completed, source: t.source || null, syncState: t.syncState}))};
}
module.exports = {SCHEMA, clone, emptyStore, validateStore, migrateStore, resolveDue, localDate, remoteState,
  addBatch, findTask, setCompleted, editTask, deleteTask, addCollection, mergedSections, editUnsent, cancelUnsent,
  readyOperations, commandFor, markSending, preflight, checkDestinations, acknowledge, reconcileAcknowledged, rememberTask, rememberCompleted, failOperations, replaceRemote, mergedTasks, privateTasks, cachedView, completedView, snapshot};
