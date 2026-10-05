// Project order is supplied by Todoist; expanded projects share one virtual list.
function projectGroups(projects, tasks, sections = []) {
  const inbox = projects.find(project => project.inbox_project || project.is_inbox_project);
  const groups = projects.map(project => ({project, tasks: []}));
  const byId = new Map(groups.map(group => [String(group.project.id), group]));
  for (const task of tasks) {
    if (task.completed || task.is_completed || task.checked || task.is_deleted) continue;
    const projectId = task.project_id || inbox?.id;
    byId.get(String(projectId))?.tasks.push(task);
  }
  for (const group of groups) {
    group.tasks = require('../workspace/intents').orderedTasks(group.tasks);
    if (!group.tasks.some(task => task.order_key)) group.tasks.sort((a, b) =>
      (a.due?.date?.slice(0, 10) || '9999-99-99').localeCompare(b.due?.date?.slice(0, 10) || '9999-99-99') || (b.priority || 1) - (a.priority || 1));
    group.collections = require('../collections/model').collectionGroups(group.project.id, group.tasks, sections);
    group.hasCollections = sections.some(s => String(s.project_id) === String(group.project.id) && !s.is_deleted && !s.is_archived) || group.tasks.some(t => t.section_id);
  }
  return groups;
}
function overviewRows(groups, expanded) {
  return groups.flatMap(group => {
    const id = String(group.project.id);
    const rows = [{key: `project:${id}`, type: 'project', ...group, expanded: !!expanded[id]}];
    if (expanded[id]) {
      if (group.hasCollections) {
        for (const collection of group.collections) {
          rows.push({key: `collection:${id}:${collection.id}`, type: 'collection', projectId: id, ...collection});
          rows.push(...(collection.tasks.length ? collection.tasks.map(task => ({key: `task:${id}:${task.id}`, type: 'task', task})) :
            [{key: `empty:${id}:${collection.id}`, type: 'empty', collection: true}]));
        }
      } else rows.push(...(group.tasks.length ? group.tasks.map(task => ({key: `task:${id}:${task.id}`, type: 'task', task})) :
        [{key: `empty:${id}`, type: 'empty'}]));
    }
    return rows;
  });
}
function collapsingSelection(groups, projectId, selectedIds) {
  const hidden = new Set(groups.filter(group => projectId === null || String(group.project.id) === projectId)
    .flatMap(group => group.tasks.map(task => require('../workspace/intents').rowIdentity(task))));
  return selectedIds.filter(id => hidden.has(id));
}
module.exports = {projectGroups, overviewRows, collapsingSelection};
