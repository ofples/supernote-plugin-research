/* Native recognition is the baseline. AI proposals must pass the same review. */
const {resolveDue} = require('../offline/model');
const MAX_TASKS = 100;
const taskSchema = {
  type: 'object', additionalProperties: false,
  required: ['content', 'description', 'dueDate', 'priority', 'projectId', 'sectionId', 'labels'],
  properties: {
    content: {type: 'string'}, description: {type: 'string'},
    dueDate: {type: ['string', 'null']}, priority: {type: 'integer', enum: [1, 2, 3, 4]},
    projectId: {type: ['string', 'null']}, labels: {type: 'array', items: {type: 'string'}},
    sectionId: {type: ['string', 'null']},
  },
};
const batchSchema = {type: 'object', additionalProperties: false, required: ['tasks'],
  properties: {tasks: {type: 'array', items: taskSchema}}};

function stripBullet(line) {
  return line.trim().replace(/^(?:[-*•◦▪☐□]\s*|\[(?: |x|X)\]\s*|\d+[.)]\s+)/, '').trim();
}
function fromText(text, defaults = {}) {
  const lines = String(text).split(/\r?\n/).map(stripBullet).filter(Boolean);
  if (lines.length > MAX_TASKS) throw new Error('Select at most 100 lines at a time.');
  return lines.map(content => ({description: '', priority: 1, dueString: '',
    projectId: null, sectionId: null, labels: [], ...defaults, content, selected: true}));
}
function validateProposal(value, projects = [], sections = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).join(',') !== 'tasks' || !Array.isArray(value.tasks) ||
      !value.tasks.length || value.tasks.length > MAX_TASKS) throw new Error('AI returned an invalid task list.');
  const allowedProjects = new Set(projects.map(p => String(p.id)));
  const keys = [...taskSchema.required].sort().join(',');
  return value.tasks.map(task => {
    if (!task || Object.keys(task).sort().join(',') !== keys ||
        typeof task.content !== 'string' || !task.content.trim() || task.content.length > 500 ||
        typeof task.description !== 'string' || task.description.length > 4000 ||
        ![1, 2, 3, 4].includes(task.priority) ||
        !(task.projectId === null || (typeof task.projectId === 'string' && allowedProjects.has(task.projectId))) ||
        !(task.sectionId === null || (typeof task.sectionId === 'string' && task.projectId !== null &&
          sections.some(section => String(section.id) === task.sectionId && String(section.project_id) === task.projectId && !section.is_deleted && !section.is_archived))) ||
        !(task.dueDate === null || (typeof task.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(task.dueDate))) ||
        !Array.isArray(task.labels) || task.labels.length > 20 ||
        task.labels.some(label => typeof label !== 'string' || !label.trim() || label.length > 100)) {
      throw new Error('AI returned invalid task details. Your original rows are unchanged.');
    }
    if (task.dueDate) resolveDue(task.dueDate);
    return {...task, content: task.content.trim(), dueString: task.dueDate || '', selected: true};
  });
}
function mergeNext(rows, index) {
  if (index < 0 || index >= rows.length - 1) return rows;
  const next = rows.slice();
  next.splice(index, 2, {...rows[index], content: `${rows[index].content.trim()} ${rows[index + 1].content.trim()}`.trim()});
  return next;
}
function splitRow(rows, index) {
  const row = rows[index];
  if (!row) return rows;
  const parts = fromText(row.content, row);
  if (parts.length < 2) throw new Error('Insert a line break in the title, then split.');
  if (rows.length - 1 + parts.length > MAX_TASKS) throw new Error('A batch can contain at most 100 tasks.');
  const next = rows.slice();
  next.splice(index, 1, ...parts);
  return next;
}
module.exports = {MAX_TASKS, batchSchema, fromText, validateProposal, mergeNext, splitRow};
