/** UI intent projection. Disk/network work is injected and never blocks another row. */
function projectTask(task, intent) {
  if (!intent) return task;
  if (intent.kind === 'order') return task;
  if (intent.kind === 'delete') return {...task, deleted: true, syncState: 'pending'};
  if (intent.kind === 'complete') return {...task, completed: intent.completed,
    completed_at: intent.completed ? intent.completedAt : null, syncState: 'pending'};
  return {...task, ...intent.patch, syncState: 'pending'};
}

function createIntentQueue({commit, changed, failed}) {
  let sequence = 0;
  const pending = new Map();
  const tails = new Map();
  const snapshot = () => Array.from(pending.values());
  function submit(ids, action, request = {}) {
    const unique = [...new Set(ids.map(String))];
    if (!unique.length) return Promise.resolve();
    const intent = {...action, ids: unique, sequence: ++sequence,
      completedAt: new Date().toISOString(), request};
    pending.set(intent.sequence, intent);
    changed(snapshot());
    // Serialize only intersecting rows. A slow disk operation on A cannot
    // disable B, navigation, or the composer. Rejected operations don't poison tails.
    const dependencies = unique.map(id => tails.get(id)).filter(Boolean);
    const run = Promise.all(dependencies.map(p => p.catch(() => {})))
      .then(() => commit(unique, action, request))
      .catch(error => { failed(error, intent); throw error; })
      .finally(() => {
        pending.delete(intent.sequence);
        for (const id of unique) if (tails.get(id) === run) tails.delete(id);
        changed(snapshot());
      });
    unique.forEach(id => tails.set(id, run));
    return run;
  }
  return {submit, snapshot};
}

function projectTasks(tasks, intents) {
  let result = tasks;
  for (const intent of intents) {
    if (intent.kind === 'order') {
      result = reorderProjection(result, intent.taskId, intent.direction);
    } else result = result.map(task => intent.ids.includes(String(task.id)) ? projectTask(task, intent) : task);
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

function composerDefaults(view, projects, today, tomorrow, config = {}) {
  const inbox = projects.find(p => p.is_inbox_project || p.inbox_project || p.isInbox);
  const projectId = view.startsWith('project:') ? view.slice(8) : view === 'inbox' ? inbox?.id : config.defaultProjectId || inbox?.id;
  return {projectId: projectId || null, sectionId: view.startsWith('project:') || view === 'inbox' ? null : config.defaultSectionId || null,
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

module.exports = {createIntentQueue, projectTask, projectTasks, composerDefaults, reorderProjection, sameScope, projectContainers, projectContainerTasks};
