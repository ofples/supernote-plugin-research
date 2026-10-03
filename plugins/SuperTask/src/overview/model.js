// Project order is supplied by Todoist; expanded projects share one virtual list.
function projectGroups(projects, tasks) {
  const inbox = projects.find(project => project.inbox_project || project.is_inbox_project);
  const groups = projects.map(project => ({project, tasks: []}));
  const byId = new Map(groups.map(group => [String(group.project.id), group]));
  for (const task of tasks) {
    if (task.completed || task.is_completed || task.checked || task.is_deleted) continue;
    const projectId = task.project_id || inbox?.id;
    byId.get(String(projectId))?.tasks.push(task);
  }
  for (const group of groups) group.tasks.sort((a, b) => {
    const aDate = a.due?.date?.slice(0, 10) || '9999-99-99';
    const bDate = b.due?.date?.slice(0, 10) || '9999-99-99';
    return aDate.localeCompare(bDate) || (b.priority || 1) - (a.priority || 1);
  });
  return groups;
}
function overviewRows(groups, expanded) {
  return groups.flatMap(group => {
    const id = String(group.project.id);
    const rows = [{key: `project:${id}`, type: 'project', ...group, expanded: !!expanded[id]}];
    if (expanded[id]) {
      rows.push(...(group.tasks.length ? group.tasks.map(task => ({key: `task:${id}:${task.id}`, type: 'task', task})) :
        [{key: `empty:${id}`, type: 'empty'}]));
    }
    return rows;
  });
}
function collapsingSelection(groups, projectId, selectedIds) {
  const hidden = new Set(groups.filter(group => projectId === null || String(group.project.id) === projectId)
    .flatMap(group => group.tasks.map(task => task.id)));
  return selectedIds.filter(id => hidden.has(id));
}
module.exports = {projectGroups, overviewRows, collapsingSelection};
