/* Durable location operations. No network or UI dependencies. */
const copy = value => JSON.parse(JSON.stringify(value));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const locationKind = op => /^(project|collection)_(create|rename|delete)$/.test(op.kind);
const bucket = (store, kind) => kind === 'project' ? (store.localProjects ||= {}) : (store.collections ||= {});
const remoteList = (store, kind) => kind === 'project' ? store.projects : store.sections;
const isCreate = op => ['project_create', 'collection_create'].includes(op.kind);
function mergedProjects(store) {
  const owned = Object.values(store.localProjects || {}), ids = new Set(owned.map(p => p.remoteId));
  return [...store.projects.filter(p => !ids.has(p.id)), ...owned.filter(p => !p.deleted && !p.remoteUnavailable).map(p => ({...copy(p), id: p.remoteId || p.id,
    localId: p.id, syncState: store.outbox.some(op => op.localId === p.id) ? 'pending' : 'synced'}))];
}
function find(store, kind, id) {
  return bucket(store, kind)[id] || Object.values(bucket(store, kind)).find(p => p.remoteId === id) || remoteList(store, kind).find(p => p.id === id);
}
function permission(location, action = 'edit') {
  if (!location || location.deleted || location.is_deleted || location.is_archived || location.remoteUnavailable) {throw new Error('This location is unavailable. Refresh first.');}
  if (location.inbox_project || location.is_inbox_project) {throw new Error('Inbox cannot be renamed or deleted.');}
  if (location.is_read_only || location.is_frozen || location.can_edit === false || location.role === 'viewer') {throw new Error('This location is read-only.');}
  // Workspace/shared access cannot be inferred from the presence of cached tasks.
  if ((location.workspace_id || location.shared || location.is_shared) && location.can_edit !== true && !['admin', 'owner', 'member'].includes(location.role)) {
    throw new Error('Refresh verified project permissions before changing this shared location.');
  }
  if (action === 'delete' && location.can_delete === false) {throw new Error('You do not have permission to delete this location.');}
  if (action === 'delete' && location.workspace_id) {throw new Error('Todoist requires an administrator to archive a workspace project before deletion. Manage this workspace project in Todoist.');}
}
function own(store, kind, id) {
  const value = find(store, kind, id);
  if (!value) {throw new Error('Location is not cached. Refresh while online first.');}
  if (bucket(store, kind)[value.id]) {return value;}
  const localId = `${kind}:${value.id}`;
  return (bucket(store, kind)[localId] = {...copy(value), id: localId, remoteId: value.id, baseLocation: copy(value)});
}
function operation(ids, kind, id, extra = {}) {
  return {uuid: ids(), kind, localId: id, state: 'pending', attempts: 0, retryAt: 0, error: null, command: null, ...extra};
}
function createProject(store, name, ids, options = {}) {
  const next = copy(store), title = String(name || '').trim();
  if (!title) {throw new Error('Enter a project name.');}
  // Creation in personal space is safe offline. Workspace creation needs verified permissions.
  if (options.workspace_id) {throw new Error('Workspace project creation requires verified online workspace permissions.');}
  if (options.parent_id) {permission(find(next, 'project', options.parent_id));}
  const id = `project:${ids()}`, project = {id, remoteId: null, name: title, parent_id: options.parent_id || null};
  bucket(next, 'project')[id] = project;
  next.outbox.push(operation(ids, 'project_create', id, {tempId: ids()}));
  return {next, project: {...project, syncState: 'pending'}};
}
function rename(store, kind, id, name, ids) {
  const next = copy(store), location = own(next, kind, id), title = String(name || '').trim();
  permission(location); if (kind === 'collection') {permission(find(next, 'project', location.project_id));}
  if (!title) {throw new Error(`Enter a ${kind === 'project' ? 'project' : 'collection'} name.`);}
  if (location.name === title) {return next;}
  location.name = title;
  const ops = next.outbox.filter(op => op.localId === location.id);
  if (ops.some(op => isCreate(op) && !op.attempts)) {return next;}
  const tail = ops.at(-1);
  if (tail?.kind === `${kind}_rename` && !tail.attempts) {tail.name = title; tail.command = null;}
  else {next.outbox.push(operation(ids, `${kind}_rename`, location.id, {name: title}));}
  return next;
}
function mapProject(store, id) {return store.localProjects?.[id]?.remoteId || id;}
function scope(store, kind, id, model) {
  const location = find(store, kind, id); let reason = null;
  try {permission(location, 'delete'); if (kind === 'collection') {permission(find(store, 'project', location.project_id));}} catch (e) {reason = e.message;}
  const actual = location?.remoteId || location?.id || id;
  const projects = new Set(kind === 'project' ? [actual, id] : []);
  if (kind === 'project') {
    let changed = true;
    while (changed) {changed = false; for (const p of [...mergedProjects(store), ...(store.archivedProjects || [])]) {if (projects.has(p.parent_id) && !projects.has(p.id)) {projects.add(p.id); changed = true;}}}
  }
  const tasks = model.privateTasks(store).filter(t => !t.deleted && (kind === 'project' ? projects.has(t.project_id) : [actual, id].includes(t.section_id)));
  const history = (store.completedRemote || []).filter(t => kind === 'project' ? projects.has(t.project_id) : [actual, id].includes(t.section_id));
  const all = [...new Map([...tasks, ...history].map(t => [t.remoteId || t.id, t])).values()];
  const localOnly = !!location && !location.remoteId && !!bucket(store, kind)[location.id] && nextUnsent(store, location.id);
  const proof = store.containerScopes?.[`${kind}:${actual}`];
  const token = JSON.stringify({kind, id: actual, location: location?.baseLocation || location, projects: [...projects].sort(),
    tasks: all.map(t => ({id: t.remoteId || t.id, project_id: t.project_id, section_id: t.section_id || null, parent_id: t.parent_id || null, completed: !!(t.completed || t.is_completed)})).sort((a, b) => a.id.localeCompare(b.id))});
  const complete = localOnly || !!(proof?.complete && proof.authority === 'server-total' && proof.count === all.length && proof.token === token);
  let keepReason = complete ? null : 'All descendant projects, subtasks and completed history must be verified before keeping tasks. The current offline cache cannot prove complete scope.';
  const parent = kind === 'collection' ? find(store, 'project', location?.project_id) : location;
  if (parent?.workspace_id || parent?.shared || parent?.is_shared) {keepReason = 'Shared project history may predate this account. Complete retention scope must be managed in Todoist.';}
  if (projects.size > (projects.has(id) && id !== actual ? 2 : 1)) {reason ||= 'Move or delete descendant projects separately before deleting their parent; project hierarchy will not be flattened.';}
  const contained = new Set(all.map(t => t.remoteId || t.id));
  if (all.some(t => t.parent_id && !contained.has(t.parent_id))) {keepReason = 'This scope contains a child whose parent is outside the location. Move its parent separately.';}
  if (all.some(t => t.due?.is_recurring && (t.occurrenceHistory || t.completed || t.is_completed))) {keepReason = 'Recurring completion history cannot be retained safely in a different container. Manage it in Todoist.';}
  return {kind, id, count: all.length, descendantProjectCount: Math.max(0, projects.size - (projects.has(id) && id !== actual ? 2 : 1)),
    allowed: !reason, canKeep: !reason && !keepReason && complete, complete, countIsMinimum: !complete, keepReason, reason, scopeToken: token, tasks: all, projects: [...projects], localOnly};
}
function nextUnsent(store, id) {return store.outbox.some(op => op.localId === id && isCreate(op)) && store.outbox.filter(op => op.localId === id).every(op => !op.attempts);}
function remove(store, kind, id, options, ids, model) {
  const next = copy(store), plan = scope(next, kind, id, model);
  if (!plan.allowed) {throw new Error(plan.reason);}
  if (!['keep', 'delete'].includes(options.mode)) {throw new Error('Choose Keep tasks or Delete tasks too.');}
  if (options.scopeToken !== plan.scopeToken || options.confirmCount !== plan.count) {throw new Error('The location contents changed. Review the scope and count again.');}
  if (options.mode === 'keep' && !plan.canKeep) {throw new Error(plan.keepReason);}
  if (options.mode === 'delete' && !plan.complete && options.includeUncached !== true) {throw new Error('Confirm deletion of all contained tasks, including uncached completed history. The cached count is a minimum.');}
  if (plan.descendantProjectCount) {throw new Error('Move or delete descendant projects separately before deleting their parent; project hierarchy will not be flattened.');}
  const location = own(next, kind, id), actual = location.remoteId || location.id;
  let result = next;
  const dependencies = new Set();
  if (options.mode === 'keep') {
    if (plan.tasks.some(t => t.due?.is_recurring && (t.occurrenceHistory || t.completed || t.is_completed))) {throw new Error('Recurring completion history cannot be moved safely. Keep this container or manage its occurrences in Todoist.');}
    const destination = kind === 'collection' ? location.project_id : options.destinationProjectId;
    const project = find(result, 'project', destination);
    if (!project || plan.projects.includes(destination)) {throw new Error('Choose an available surviving destination project.');}
    if (!(project.inbox_project || project.is_inbox_project)) {permission(project);}
    // Move roots only: Todoist item_move preserves descendants. Pending children
    // are moved explicitly after their parent, never promoted to root silently.
    const contained = new Set(plan.tasks.map(t => t.remoteId || t.id));
    if (plan.tasks.some(t => t.parent_id && !contained.has(t.parent_id))) {throw new Error('This scope contains a child whose parent is outside the location. Move its parent separately.');}
    for (const task of plan.tasks.filter(t => !t.parent_id)) {
      result = model.editTask(result, task.id, {project_id: destination, section_id: null}, ids);
      const root = model.findTask(result, task.id);
      for (const op of result.outbox.filter(o => o.localId === root.id)) {dependencies.add(op.uuid);}
      for (const child of plan.tasks.filter(t => t.parent_id)) {
        const owned = model.ownTask(result, child.id); owned.project_id = destination; owned.section_id = null;
        // Existing remote descendants move with their root; local descendants
        // are rejected because beta12 does not support local parent creation.
        if (!owned.remoteId) {throw new Error('Sync new subtasks before moving this container.');}
      }
    }
  } else {
    for (const task of plan.tasks) {
      const owned = model.ownTask(result, task.id); owned.deleted = true;
      // Uncertain writes must replay before a cascading delete. Never drop an
      // already sent UUID even when deletion supersedes its visible intent.
      for (const op of result.outbox.filter(o => o.localId === owned.id && o.attempts)) {dependencies.add(op.uuid);}
      result.outbox = result.outbox.filter(op => op.localId !== owned.id || op.attempts);
    }
  }
  location.deleted = true;
  const target = bucket(result, kind)[location.id]; target.deleted = true;
  if (plan.localOnly) {
    if (options.mode === 'delete') {
      for (const task of plan.tasks) {
        const local = model.findTask(result, task.id);
        if (result.outbox.some(op => op.localId === local.id && op.attempts)) {throw new Error('A dependent task may already exist remotely. Sync it before deleting the container.');}
        result.outbox = result.outbox.filter(op => op.localId !== local.id); delete result.tasks[local.id];
      }
    }
    if (result.outbox.some(op => op.localId !== location.id && (op.patch?.project_id === actual || op.patch?.section_id === actual || result.tasks[op.localId]?.project_id === actual || result.tasks[op.localId]?.section_id === actual))) {
      throw new Error('Dependent operations still use this location. Resolve them before deletion.');
    }
    result.outbox = result.outbox.filter(op => op.localId !== location.id); delete bucket(result, kind)[location.id];
    if (kind === 'project') {for (const [key, s] of Object.entries(result.collections)) {if (s.project_id === actual) {result.outbox = result.outbox.filter(op => op.localId !== key); delete result.collections[key];}}}
    return result;
  }
  const activeBaseline = result.remote.filter(t => kind === 'project' ? plan.projects.includes(t.project_id) : [actual, id].includes(t.section_id));
  result.outbox.push(operation(ids, `${kind}_delete`, location.id, {dependencies: [...dependencies], scopeToken: plan.scopeToken,
    recovery: {mode: options.mode, tasks: copy(plan.tasks), projects: copy(plan.projects), activeBaseline: copy(activeBaseline), includeUncached: !!options.includeUncached},
    capturedAt: new Date().toISOString(), verificationBudget: result.containerScopes?.[`${kind}:${actual}`]?.maxPages || 30, expectedEmpty: options.mode === 'keep'}));
  return result;
}
function command(store, op) {
  const kind = op.kind.startsWith('project_') ? 'project' : 'collection', location = bucket(store, kind)[op.localId];
  const type = kind === 'project' ? 'project' : 'section';
  if (isCreate(op)) {return {type: `${type}_add`, uuid: op.uuid, temp_id: op.tempId, args: {name: location.name,
    ...(kind === 'collection' ? {project_id: mapProject(store, location.project_id)} : location.parent_id ? {parent_id: mapProject(store, location.parent_id)} : {})}};}
  return {type: `${type}_${op.kind.endsWith('_rename') ? 'update' : 'delete'}`, uuid: op.uuid,
    args: {id: location.remoteId, ...(op.kind.endsWith('_rename') ? {name: op.name} : {})}};
}
function ready(store, op) {
  const kind = op.kind.startsWith('project_') ? 'project' : 'collection', location = bucket(store, kind)[op.localId];
  const projectId = kind === 'collection' ? location.project_id : location.parent_id;
  if (projectId && store.localProjects?.[projectId] && !store.localProjects[projectId].remoteId) {return false;}
  if (op.dependencies?.some(uuid => store.outbox.some(o => o.uuid === uuid))) {return false;}
  if (op.dependencies?.some(uuid => store.acknowledgedOperations?.[uuid] !== true)) {return false;}
  return isCreate(op) || !!location.remoteId;
}
function acknowledge(store, op, response, now) {
  const kind = op.kind.startsWith('project_') ? 'project' : 'collection', location = bucket(store, kind)[op.localId];
  if (isCreate(op)) {
    const remoteId = response.temp_id_mapping?.[op.tempId]; if (typeof remoteId !== 'string' || !remoteId) {return false;}
    location.remoteId = remoteId; location.baseLocation = {...copy(location), id: remoteId};
    if (kind === 'project') {
      for (const task of Object.values(store.tasks)) {if (task.project_id === op.localId) {task.project_id = remoteId;}}
      for (const s of Object.values(store.collections)) {if (s.project_id === op.localId) {s.project_id = remoteId;}}
      for (const p of Object.values(store.localProjects || {})) {if (p.parent_id === op.localId) {p.parent_id = remoteId;}}
      for (const dependent of store.outbox) {if (!dependent.attempts && dependent.patch?.project_id === op.localId) {dependent.patch.project_id = remoteId;}}
    } else {
      for (const task of Object.values(store.tasks)) {if (task.section_id === op.localId) {task.section_id = remoteId;}}
      for (const dependent of store.outbox) {if (!dependent.attempts && dependent.patch?.section_id === op.localId) {dependent.patch.section_id = remoteId;}}
    }
  } else if (op.kind.endsWith('_rename')) {location.baseLocation = {...location.baseLocation, name: op.name};}
  else {location.deleted = true; location.deleteAcknowledged = true;}
  location.acknowledgedAt = now; return true;
}
function reconcile(store) {
  for (const op of store.outbox) {
    if (!op.attempts && op.dependencies?.some(uuid => !store.outbox.some(o => o.uuid === uuid) && store.acknowledgedOperations?.[uuid] !== true)) {
      op.state = 'attention'; op.error = 'A required retention move was cancelled or conflicted. The container cannot be deleted until its scope is reviewed again.';
    }
  }
  for (const kind of ['project', 'collection']) {for (const location of Object.values(bucket(store, kind))) {
    if (!location.remoteId || location.deleted) {continue;}
    const latest = remoteList(store, kind).find(p => p.id === location.remoteId);
    location.remoteUnavailable = !latest;
    if (!latest || store.outbox.some(op => op.localId === location.id)) {continue;}
    Object.assign(location, latest, {id: location.id, remoteId: location.remoteId, baseLocation: copy(latest)});
  }}
}
function preflight(store, op) {
  const kind = op.kind.startsWith('project_') ? 'project' : 'collection', location = bucket(store, kind)[op.localId];
  const latest = remoteList(store, kind).find(p => p.id === location.remoteId);
  try {permission(latest, op.kind.endsWith('_delete') ? 'delete' : 'edit'); if (kind === 'collection') {permission(find(store, 'project', latest.project_id));}} catch (e) {op.state = 'attention'; op.error = e.message; return;}
  if (op.kind.endsWith('_delete')) {
    const projectIds = op.recovery.projects;
    const currentProjects = [...mergedProjects(store), ...(store.archivedProjects || [])].filter(p => projectIds.includes(p.parent_id) && !projectIds.includes(p.id));
    const active = store.remote.filter(t => kind === 'project' ? projectIds.includes(t.project_id) : t.section_id === location.remoteId);
    const state = t => ({id: t.id, project_id: t.project_id, section_id: t.section_id || null, parent_id: t.parent_id || null,
      content: t.content, description: t.description || '', due: t.due || null, labels: t.labels || [], priority: t.priority || 1});
    const normalized = rows => rows.map(state).sort((a, b) => a.id.localeCompare(b.id));
    if (currentProjects.length || (op.expectedEmpty ? active.length : !equal(normalized(active), normalized(op.recovery.activeBaseline)))) {
      op.state = 'attention'; op.error = 'The container contents changed on Todoist. Review its current scope again before deleting; nothing was sent.'; return;
    }
  }
  if (!location.baseLocation || latest.name !== location.baseLocation.name || latest.parent_id !== location.baseLocation.parent_id || latest.project_id !== location.baseLocation.project_id || latest.created_at !== location.baseLocation.created_at || latest.added_at !== location.baseLocation.added_at) {
    store.conflictArchive.push({localId: location.id, desired: copy(location), operations: [copy(op)]});
    store.syncNotices.push({localId: location.id, message: 'This location changed on Todoist. The Todoist version was kept.'});
    store.outbox = store.outbox.filter(o => o.localId !== location.id || o.attempts);
    Object.assign(location, latest, {id: location.id, remoteId: location.remoteId, baseLocation: copy(latest)});
    if (op.kind.endsWith('_delete')) {
      location.deleted = false;
      for (const cached of op.recovery.tasks) {
        const task = Object.values(store.tasks).find(t => t.id === cached.id || t.remoteId === (cached.remoteId || cached.id));
        if (task) {task.deleted = false;}
      }
    }
  }
}
module.exports = {locationKind, isCreate, mergedProjects, find, permission, createProject, rename, scope, remove, mapProject, command, ready, acknowledge, reconcile, preflight, equal};
