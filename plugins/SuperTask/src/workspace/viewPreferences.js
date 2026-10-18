const VIEWS = ['list', 'board'];
const GROUPS = ['collection', 'project', 'date', 'none'];
const SORTS = ['manual', 'priority', 'due', 'title'];
const {projectSections} = require('../collections/model');
const {getDueDateTimeKey} = require('../components/taskDueLabel');

function defaults(context) {
  const groupBy = context.startsWith('project:') || context === 'inbox' ? 'collection' :
    ['upcoming', 'tomorrow'].includes(context) ? 'date' : ['note', 'device', 'done'].includes(context) ? 'none' : 'project';
  return {view: 'list', groupBy, sortBy: 'manual', completedExpanded: false};
}

function normalizePreferences(value, context) {
  const fallback = defaults(context);
  const source = value && typeof value === 'object' ? value : {};
  return {
    view: VIEWS.includes(source.view) ? source.view : fallback.view,
    groupBy: GROUPS.includes(source.groupBy) ? source.groupBy : fallback.groupBy,
    sortBy: SORTS.includes(source.sortBy) ? source.sortBy : fallback.sortBy,
    completedExpanded: typeof source.completedExpanded === 'boolean' ? source.completedExpanded : fallback.completedExpanded,
  };
}

function preferencesForAccount(store, accountKey) {
  return accountKey ? store?.accounts?.[accountKey] || {} : {};
}

function mergePreferencePatches(loaded, patches) {
  return Object.entries(patches || {}).reduce((next, [context, patch]) => ({
    ...next, [context]: normalizePreferences({...next[context], ...patch}, context),
  }), {...(loaded || {})});
}

function sortTasks(tasks, sortBy) {
  const result = [...(tasks || [])];
  if (sortBy === 'priority') return result.sort((a, b) => (Number(b.priority) || 1) - (Number(a.priority) || 1));
  if (sortBy === 'due') return result.sort((a, b) => {
    const leftRaw = String(a.due?.datetime || a.due?.date || ''), rightRaw = String(b.due?.datetime || b.due?.date || '');
    return (leftRaw ? 0 : 1) - (rightRaw ? 0 : 1) || getDueDateTimeKey(leftRaw).localeCompare(getDueDateTimeKey(rightRaw));
  });
  if (sortBy === 'title') return result.sort((a, b) => String(a.content || a.title || '').localeCompare(String(b.content || b.title || '')));
  return result;
}

function groupTasks(tasks, groupBy, {projects = [], collections = [], today = '', projectId = null, includeEmptyCollections = false} = {}) {
  const projectNames = new Map(projects.map(item => [String(item.id), item.name]));
  const collectionNames = new Map(collections.map(item => [String(item.id), item.name]));
  const projectPosition = new Map(projects.map((item, index) => [String(item.id), index]));
  const keyFor = task => {
    if (groupBy === 'collection') {
      const parent = String(task.project_id || projectId || 'inbox');
      return `collection:${encodeURIComponent(parent)}:${encodeURIComponent(task.section_id || 'none')}`;
    }
    if (groupBy === 'project') return `project:${encodeURIComponent(String(task.project_id || 'inbox'))}`;
    if (groupBy === 'date') {
      const date = getDueDateTimeKey(String(task.due?.datetime || task.due?.date || '')).slice(0, 10);
      if (!date) return 'date:undated';
      if (date < today) return 'date:overdue';
      return `date:${date}`;
    }
    return 'all';
  };
  const groups = new Map();
  for (const task of tasks || []) {
    const key = keyFor(task);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(task);
  }
  if (!groups.size && groupBy === 'none') groups.set('all', []);
  if (groupBy === 'collection' && includeEmptyCollections && projectId) {
    const parent = String(projectId);
    for (const section of projectSections(collections, projectId)) {
      const key = `collection:${encodeURIComponent(parent)}:${encodeURIComponent(String(section.id))}`;
      if (!groups.has(key)) groups.set(key, []);
    }
    const looseKey = `collection:${encodeURIComponent(parent)}:none`;
    if (!groups.has(looseKey)) groups.set(looseKey, []);
  }
  const result = [...groups.entries()].map(([key, items]) => {
    let title = key;
    if (groupBy === 'collection') {
      const [, parentValue, sectionValue] = key.split(':');
      const parent = decodeURIComponent(parentValue), section = decodeURIComponent(sectionValue);
      const sectionName = section === 'none' ? 'No collection' : collectionNames.get(section) || 'Unavailable collection';
      title = projectId ? sectionName : `${projectNames.get(parent) || (parent === 'inbox' ? 'Inbox' : 'Project')} / ${sectionName}`;
    } else if (groupBy === 'project') {
      const parent = decodeURIComponent(key.slice('project:'.length));
      title = projectNames.get(parent) || (parent === 'inbox' ? 'Inbox' : 'Unavailable project');
    } else if (groupBy === 'date') {
      const date = key.slice('date:'.length);
      title = date === 'undated' ? 'Undated' : date === 'overdue' ? 'Overdue' : date;
    } else if (groupBy === 'none') title = 'Tasks';
    return {key, title, tasks: items};
  });
  const order = group => {
    if (groupBy === 'date') {
      const value = group.key.slice('date:'.length);
      return value === 'overdue' ? '0' : value === 'undated' ? '2' : `1${value}`;
    }
    if (groupBy === 'project') {
      const parent = decodeURIComponent(group.key.slice('project:'.length));
      return String(projectPosition.get(parent) ?? 999999).padStart(8, '0') + parent;
    }
    if (groupBy === 'collection') {
      const [, parentValue, sectionValue] = group.key.split(':');
      const parent = decodeURIComponent(parentValue), section = decodeURIComponent(sectionValue);
      const sectionIndex = projectSections(collections, parent).findIndex(item => String(item.id) === section);
      const sectionPosition = section === 'none' ? 0 : sectionIndex < 0 ? 999999 : sectionIndex + 1;
      return String(projectPosition.get(parent) ?? 999999).padStart(8, '0') + ':' + String(sectionPosition).padStart(8, '0') + ':' + section;
    }
    return group.key;
  };
  return result.sort((a, b) => order(a).localeCompare(order(b)));
}

module.exports = {VIEWS, GROUPS, SORTS, defaults, normalizePreferences, preferencesForAccount, mergePreferencePatches, sortTasks, groupTasks};
