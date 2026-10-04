const {resolveDue} = require('./model');
const {locationChange} = require('../collections/model');

// Forms often submit every field. Queue only actual changes, especially so an
// unrelated edit cannot turn a recurring/time-zone-aware due into a plain date.
function taskPatch(task, changes, projects = [], sections = [], now = Date.now()) {
  const patch = {};
  for (const key of ['content', 'description', 'priority']) {
    if (changes[key] !== undefined && changes[key] !== task[key]) patch[key] = changes[key];
  }
  if (changes.labels !== undefined && JSON.stringify(changes.labels) !== JSON.stringify(task.labels || [])) {
    patch.labels = changes.labels;
  }
  if (changes.dueString !== undefined && changes.dueString !== (task.due?.string || task.due?.date || '')) {
    patch.due = changes.dueString ? resolveDue(changes.dueString, now) : null;
  }
  const location = locationChange(task, changes, projects, sections);
  if (location.changed) {
    patch.project_id = location.projectId;
    patch.section_id = location.sectionId;
  }
  return patch;
}
module.exports = {taskPatch};
