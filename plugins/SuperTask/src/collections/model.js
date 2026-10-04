// Todoist calls collections "sections". Keep identifiers, never infer by name.
function projectSections(sections = [], projectId) {
  return sections.filter(s => String(s.project_id) === String(projectId) && !s.is_deleted && !s.is_archived)
    .sort((a, b) => a.order_key && b.order_key ? (a.order_key < b.order_key ? -1 : a.order_key > b.order_key ? 1 : 0) :
      (a.section_order ?? a.order ?? 0) - (b.section_order ?? b.order ?? 0));
}
function validateLocation(projectId, sectionId, sections = []) {
  if (sectionId && !projectSections(sections, projectId).some(s => String(s.id) === String(sectionId))) {
    throw new Error('This collection is unavailable in the selected project. Choose a collection or No collection.');
  }
}
function collectionGroups(projectId, tasks, sections = []) {
  const groups = projectSections(sections, projectId).map(section => ({id: String(section.id), name: section.name, tasks: []}));
  const byId = new Map(groups.map(g => [g.id, g]));
  const loose = {id: null, name: 'No collection', tasks: []};
  const unknown = {id: 'unavailable', name: 'Unavailable collections', tasks: []};
  for (const task of tasks) {
    if (!task.section_id) loose.tasks.push(task);
    else (byId.get(String(task.section_id)) || unknown).tasks.push(task);
  }
  if (loose.tasks.length || !groups.length) groups.unshift(loose);
  if (unknown.tasks.length) groups.push(unknown);
  return groups;
}
// Moves use a separate Todoist endpoint. Omitted fields preserve location;
// changing project clears the previous section unless explicitly replaced.
function locationChange(task, changes, projects, sections) {
  const inbox = projects.find(p => p.inbox_project || p.is_inbox_project);
  const projectId = changes.projectId === undefined ? task.project_id || null : changes.projectId || inbox?.id || null;
  const projectChanged = (projectId || null) !== (task.project_id || null);
  if (projectChanged && !projectId) throw new Error('Refresh projects before choosing Inbox.');
  const suppliedSection = changes.sectionId === undefined ? (projectChanged ? null : task.section_id || null) : changes.sectionId || null;
  const sectionId = sections.find(s => s.localId === suppliedSection && !s.is_deleted && !s.is_archived)?.id || suppliedSection;
  const changed = projectChanged || sectionId !== (task.section_id || null);
  if (changed) validateLocation(projectId, sectionId, sections);
  return {projectId, sectionId, changed, body: sectionId ? {section_id: sectionId} : {project_id: projectId}};
}
module.exports = {projectSections, validateLocation, collectionGroups, locationChange};
