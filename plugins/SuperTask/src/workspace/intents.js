/** UI intent projection. Disk/network work is injected and never blocks another row. */
function projectTask(task, intent) {
  if (!intent) return task;
  if (intent.kind === 'order') return task;
  if (intent.kind === 'delete') return {...task, deleted: true, syncState: 'pending'};
  if (intent.kind === 'complete') return {...task, completed: intent.completed,
    completed_at: intent.completed ? intent.completedAt : null, syncState: intent.uncertain ? 'attention' : 'pending', savingLocally: !intent.uncertain};
  return {...task, ...intent.patch, syncState: intent.uncertain ? 'attention' : 'pending', savingLocally: !intent.uncertain};
}

function createIntentQueue({commit, changed, failed, account = () => null}) {
  let sequence = 0;
  const pending = new Map();
  const tails = new Map();
  const failures = new Map();
  const snapshot = () => Array.from(pending.values()).sort((a, b) => a.sequence - b.sequence);
  const publish = () => changed(snapshot(), Array.from(failures.values()));
  let generation = 0;
  function runIntent(intent) {
    const {ids, request} = intent, epoch = generation;
    const dependencies = ids.map(id => tails.get(id)).filter(Boolean);
    pending.set(intent.sequence, intent); failures.delete(intent.sequence); publish();
    const run = Promise.all(dependencies.map(p => p.catch(() => {}))).then(() => {
      if (epoch !== generation || account() !== intent.account) {const error = new Error('The account changed. This interaction was cancelled.'); error.code = 'ACCOUNT_CHANGED'; throw error;}
      if ([...failures.values()].some(value => value.uncertain && value.sequence < intent.sequence && value.ids.some(id => ids.includes(id)))) {
        const error = new Error('Retry the earlier uncertain save on this task first.'); error.uncertainCommit = true; throw error;
      }
      return commit(ids, intent.action, request);
    }).then(result => {
      // A later successful intent must not leave an older rolled-back retry
      // capable of overwriting that final intent.
      for (const [key, value] of failures) if (!value.uncertain && value.sequence < intent.sequence && value.ids.some(id => ids.includes(id))) failures.delete(key);
      return result;
    }).catch(error => {
      if (epoch !== generation || error.code === 'ACCOUNT_CHANGED' || account() !== intent.account) return;
      intent.uncertain = !!error.uncertainCommit;
      intent.error = error.message || 'Could not save this change.';
      failures.set(intent.sequence, intent); failed(error, intent); throw error;
    }).finally(() => {
      if (epoch !== generation) return;
      if (!intent.uncertain) pending.delete(intent.sequence);
      for (const id of ids) if (tails.get(id) === run) tails.delete(id);
      publish();
    });
    ids.forEach(id => tails.set(id, run)); return run;
  }
  function submit(ids, action, request = {}) {
    const unique = [...new Set(ids.map(String))];
    if (!unique.length) return Promise.resolve();
    const frozen = JSON.parse(JSON.stringify(action));
    const intent = {...frozen, action: frozen, ids: unique, sequence: ++sequence,
      completedAt: new Date().toISOString(), request, account: account()};
    // A newer known intent supersedes a rolled-back older retry on these rows.
    for (const [key, value] of failures) if (!value.uncertain && value.ids.some(id => unique.includes(id))) failures.delete(key);
    return runIntent(intent);
  }
  return {submit, snapshot, retry: sequence => {
    const intent = failures.get(sequence); if (!intent) return Promise.resolve();
    intent.uncertain = false; return runIntent(intent);
  }, cancel: (notify = true) => {generation++; pending.clear(); failures.clear(); tails.clear(); if (notify) publish();}};
}

function projectTasks(tasks, intents) {
  let result = tasks;
  for (const intent of intents) {
    if (intent.kind === 'order') {
      result = reorderProjection(result, intent.taskId, intent.direction);
    } else result = result.map(task => task.occurrenceHistory && task.due?.is_recurring ? task :
      intent.ids.some(id => id === String(task.id) || id === String(task.remoteId)) ? projectTask(task, intent) : task);
  }
  return result;
}

function sameScope(a, b) {
  return String(a.project_id || '') === String(b.project_id || '') &&
    String(a.section_id || '') === String(b.section_id || '') && String(a.parent_id || '') === String(b.parent_id || '');
}
function reorderProjection(tasks, id, direction) {
  const result = [...tasks], task = result.find(value => String(value.id) === String(id));
  if (!task) return result;
  const indices = result.flatMap((value, index) => !value.deleted && !value.completed && sameScope(value, task) ? [index] : []);
  const position = indices.findIndex(index => String(result[index].id) === String(id));
  const destination = position + (direction === 'up' ? -1 : 1);
  if (position < 0 || destination < 0 || destination >= indices.length) return result;
  [result[indices[position]], result[indices[destination]]] = [result[indices[destination]], result[indices[position]]];
  return result;
}

function orderedTasks(tasks) {
  const result = [...tasks], groups = new Map();
  tasks.forEach((task, index) => {
    const scope = JSON.stringify([task.project_id || null, task.section_id || null, task.parent_id || null]);
    if (!groups.has(scope)) groups.set(scope, []);
    groups.get(scope).push(index);
  });
  for (const indices of groups.values()) {
    const rows = indices.map(index => tasks[index]);
    if (rows.every(task => task.order_key)) rows.sort((a, b) => a.order_key < b.order_key ? -1 : a.order_key > b.order_key ? 1 : String(a.id).localeCompare(String(b.id)));
    indices.forEach((index, position) => {result[index] = rows[position];});
  }
  return result;
}
function composerDefaults(view, projects, today, tomorrow, config = {}) {
  const inbox = projects.find(p => p.is_inbox_project || p.inbox_project || p.isInbox);
  const smartInbox = ['inbox', 'today', 'tomorrow', 'upcoming'].includes(view);
  const projectId = view.startsWith('project:') ? view.slice(8) : smartInbox ? inbox?.id : config.defaultProjectId || inbox?.id;
  return {projectId: projectId || null, sectionId: view.startsWith('project:') || smartInbox ? null : config.defaultSectionId || null,
    dueDate: view === 'today' ? today : view === 'tomorrow' ? tomorrow : ''};
}

function projectContainers(items, operations, scope) {
  return operations.filter(op => op.scope === scope).reduce((result, op) => {
    if (op.action === 'create') return [...result, {id: op.id, name: op.name, project_id: op.projectId, syncState: 'pending'}];
    if (op.action === 'delete') return result.filter(item => String(item.id) !== op.id);
    return result.map(item => String(item.id) === op.id ? {...item, name: op.name, syncState: 'pending'} : item);
  }, items);
}
function projectContainerTasks(tasks, operations) {
  return operations.filter(op => op.action === 'delete').reduce((result, op) => result.map(task => {
    const member = op.scope === 'project' ? String(task.project_id) === op.id : String(task.section_id) === op.id;
    if (!member) return task;
    return op.mode === 'delete' ? {...task, deleted: true} : {...task,
      project_id: op.destinationProjectId, section_id: null, syncState: 'pending'};
  }), tasks);
}

function resolveContainerId(id, containers) {
  if (id == null) return null;
  return containers.find(value => String(value.id) === String(id) || String(value.localId) === String(id))?.id || id;
}
function rowIdentity(task) {
  const id = task.remoteId && String(task.id) === `remote:${task.remoteId}` ? String(task.remoteId) : String(task.id);
  return task.completed && (task.due?.is_recurring || task.occurrencePending || task.awaitingRecurrence) ?
    `occurrence:${id}:${task.occurrenceCompletedAt || task.completed_at || task.due?.date || ''}` : id;
}
function protectedOccurrence(task, pendingChanges = []) {
  if (!task.completed || !(task.due?.is_recurring || task.occurrencePending || task.awaitingRecurrence)) return false;
  if (task.occurrenceHistory || task.awaitingRecurrence) return true;
  const operation = pendingChanges.find(change => change.kind === 'recurring_complete' && [task.id, task.localId].includes(change.id));
  return !operation || operation.state === 'sending' || operation.attempts !== 0;
}
module.exports = {createIntentQueue, projectTask, projectTasks, composerDefaults, reorderProjection, sameScope, projectContainers, projectContainerTasks, resolveContainerId, rowIdentity, protectedOccurrence, orderedTasks};
