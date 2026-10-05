/* Native recognition is the baseline. AI proposals must pass the same review. */
const {resolveDue} = require('../offline/model');
const {MAX_SOURCE_ROW_LENGTH, MAX_TRANSCRIPTION_LENGTH, stripBullet, splitTitleDescription} = require('./descriptionParser');
const MAX_TASKS = 100;
const taskSchema = {
  type: 'object', additionalProperties: false,
  required: ['content', 'description', 'dueDate', 'priority', 'projectId', 'sectionId', 'labels', 'sourceRowIds', 'sourceText', 'explicitFields'],
  properties: {
    content: {type: 'string'}, description: {type: 'string'},
    dueDate: {type: ['string', 'null']}, priority: {type: 'integer', enum: [1, 2, 3, 4]},
    projectId: {type: ['string', 'null']}, labels: {type: 'array', items: {type: 'string'}},
    sectionId: {type: ['string', 'null']},
    sourceRowIds: {type: 'array', items: {type: 'string'}},
    sourceText: {type: 'string'},
    explicitFields: {type: 'array', items: {type: 'string', enum: ['location', 'dueString', 'priority', 'labels']}},
  },
};
const batchSchema = {type: 'object', additionalProperties: false, required: ['tasks'],
  properties: {tasks: {type: 'array', items: taskSchema}}};

function fromText(text, defaults = {}) {
  const transcription = String(text);
  if (transcription.length > MAX_TRANSCRIPTION_LENGTH) {
    throw new Error('The transcription is too large to review.');
  }
  const lines = transcription.split(/\r?\n/).map(line => ({sourceText: line.trim(), text: stripBullet(line)})).filter(line => line.text);
  if (lines.length > MAX_TASKS) {
    throw new Error('Select at most 100 lines at a time.');
  }
  return lines.map(({sourceText, text: rowText}) => {
    if (sourceText.length > MAX_SOURCE_ROW_LENGTH) {
      throw new Error('A transcription row is too long to review.');
    }
    const parsed = splitTitleDescription(rowText);
    return {priority: 1, dueString: '',
      projectId: null, sectionId: null, labels: [], ...defaults,
      content: parsed.content, description: parsed.split ? parsed.description : (defaults.description || ''),
      sourceText, sourceRowIds: [], fieldProvenance: {content: 'transcription',
        description: parsed.split || defaults.description ? 'transcription' : 'empty'}, selected: true};
  });
}
function validateProposal(value, projects = [], sections = [], rows = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).join(',') !== 'tasks' || !Array.isArray(value.tasks) ||
      !value.tasks.length || value.tasks.length > MAX_TASKS) throw new Error('AI returned an invalid task list.');
  const allowedProjects = new Set(projects.map(p => String(p.id)));
  const keys = [...taskSchema.required].sort().join(',');
  const proposals = value.tasks.map(task => {
    if (!task || Object.keys(task).sort().join(',') !== keys ||
        typeof task.content !== 'string' || !task.content.trim() || task.content.length > 500 ||
        typeof task.description !== 'string' || task.description.length > 4000 ||
        typeof task.sourceText !== 'string' || task.sourceText.length > 8000 ||
        !Array.isArray(task.explicitFields) || new Set(task.explicitFields).size !== task.explicitFields.length ||
        task.explicitFields.some(field => !['location', 'dueString', 'priority', 'labels'].includes(field)) ||
        !Array.isArray(task.sourceRowIds) || new Set(task.sourceRowIds).size !== task.sourceRowIds.length ||
        task.sourceRowIds.some(id => typeof id !== 'string' || !rows.some(row => String(row.rowId) === id)) ||
        (rows.length > 0 && !task.sourceRowIds.length) ||
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
    const sources = rows.filter(row => task.sourceRowIds.includes(String(row.rowId)));
    const sourceText = sources.length ? sources.map(row => row.sourceText || row.content).join('\n') : task.sourceText;
    const inherited = sources.length && sources.every(row => (row.projectId || null) === task.projectId &&
      (row.sectionId || null) === task.sectionId);
    const location = resolveExplicitLocation(sourceText, projects, sections);
    if (!inherited && (task.projectId !== null || task.sectionId !== null) &&
        (!location || location.projectId !== task.projectId || location.sectionId !== task.sectionId)) {
      throw new Error('AI location must match an explicit, unambiguous project or collection phrase. Original rows are unchanged.');
    }
    const next = {...task, content: task.content.trim(), dueString: task.dueDate || '', selected: true,
      sourceText, fieldProvenance: {content: 'ai-proposal', description: 'ai-proposal'}};
    const proof = {location: !!location, dueString: /\b(?:today|tomorrow|tonight|next|every|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|due)\b|\d{4}-\d{2}-\d{2}/i.test(sourceText),
      priority: /\b(?:important|urgent|priority|p[1-4])\b/i.test(sourceText), labels: /(?:^|\s)#[\p{L}\p{N}_-]+|\blabels?\s*:/iu.test(sourceText)};
    next.explicitFields = task.explicitFields.filter(field => proof[field]);
    const first = sources[0];
    if (first) {
      for (const [field, keys] of Object.entries({location: ['projectId', 'sectionId'], dueString: ['dueString'], priority: ['priority'], labels: ['labels']})) {
        if (!next.explicitFields.includes(field)) {
          if (!sources.every(row => keys.every(key => JSON.stringify(row[key] ?? null) === JSON.stringify(first[key] ?? null)))) {
            throw new Error('AI combined rows with different task details. Keep those rows separate or align their details first.');
          }
          for (const key of keys) next[key] = first[key] ?? (key === 'labels' ? [] : key === 'dueString' ? '' : key === 'priority' ? 1 : null);
        }
      }
    } else {
      if (!next.explicitFields.includes('dueString')) next.dueString = '';
      if (!next.explicitFields.includes('priority')) next.priority = 1;
      if (!next.explicitFields.includes('labels')) next.labels = [];
    }
    if (next.projectId !== null && !next.explicitFields.includes('location') && !inherited && !first) {
      next.projectId = null; next.sectionId = null;
    }
    return next;
  });
  if (rows.some(row => !proposals.some(task => task.sourceRowIds.includes(String(row.rowId))))) {
    throw new Error('AI omitted a selected row. Original rows are unchanged.');
  }
  return proposals;
}
function resolveExplicitLocation(text, projects, sections) {
  const source = String(text), matches = new Map();
  const normal = value => String(value).trim().toLocaleLowerCase();
  const escape = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const project of projects) {
    if (!project.name) continue;
    const name = escape(project.name);
    for (const pattern of [`(?:^|\\s)(?:in\\s+|project\\s*:\\s*)(${name})(?=$|[\\s,.;/])`, `(?:^|\\s)(${name})\\s*/`]) {
      const regex = new RegExp(pattern, 'gi'); let match;
      while ((match = regex.exec(source))) {
        const index = match.index + match[0].indexOf(match[1]);
        const existing = matches.get(index);
        if (!existing || project.name.length > existing.project.name.length) matches.set(index, {index, project});
      }
    }
  }
  const destinations = [];
  for (const {index, project} of matches.values()) {
    if (projects.filter(p => normal(p.name) === normal(project.name)).length !== 1) return null;
    let sectionId = null;
    const tail = source.slice(index + project.name.length);
    if (/^\s*\//.test(tail)) {
      const sectionText = tail.replace(/^\s*\/\s*/, '');
      const candidates = sections.filter(s => String(s.project_id) === String(project.id) && !s.is_deleted && !s.is_archived &&
        new RegExp(`^${escape(s.name)}(?=$|[\\s,.;])`, 'i').test(sectionText)).sort((a, b) => b.name.length - a.name.length);
      if (!candidates.length || candidates.filter(s => normal(s.name) === normal(candidates[0].name)).length !== 1) return null;
      sectionId = String(candidates[0].id);
    }
    destinations.push({projectId: String(project.id), sectionId});
  }
  const distinct = new Map(destinations.map(value => [JSON.stringify(value), value]));
  return distinct.size === 1 ? [...distinct.values()][0] : null;
}
function explicitLocation(text, projectId, sectionId, projects, sections) {
  const value = resolveExplicitLocation(text, projects, sections);
  return !!value && value.projectId === projectId && value.sectionId === sectionId;
}
function mergeNext(rows, index) {
  if (index < 0 || index >= rows.length - 1) return rows;
  const next = rows.slice();
  const left = rows[index], right = rows[index + 1];
  const sourceText = [left.sourceText || left.content, right.sourceText || right.content].filter(Boolean).join('\n');
  if (sourceText.length > MAX_SOURCE_ROW_LENGTH) throw new Error('The merged transcription is too long to review.');
  const fieldProvenance = {};
  for (const field of ['content', 'description']) {
    const leftSource = left.fieldProvenance?.[field] || 'transcription';
    const rightSource = right.fieldProvenance?.[field] || 'transcription';
    if (field === 'content') {
      fieldProvenance[field] = 'manual';
    } else if (!left.description) {
      fieldProvenance[field] = rightSource;
    } else if (!right.description || leftSource === rightSource) {
      fieldProvenance[field] = leftSource;
    } else {
      fieldProvenance[field] = 'mixed';
    }
  }
  next.splice(index, 2, {...left, content: `${left.content.trim()} ${right.content.trim()}`.trim(),
    description: [left.description, right.description].filter(Boolean).join('\n'), sourceText,
    sourceRowIds: [...new Set([...(left.sourceRowIds || []), ...(right.sourceRowIds || [])])], fieldProvenance});
  return next;
}
function splitRow(rows, index) {
  const row = rows[index];
  if (!row) return rows;
  const parts = fromText(row.content, row).map(part => ({...part, sourceText: row.sourceText || row.content,
    sourceRowIds: [...(row.sourceRowIds || [])]}));
  if (parts.length < 2) throw new Error('Insert a line break in the title, then split.');
  if (rows.length - 1 + parts.length > MAX_TASKS) throw new Error('A batch can contain at most 100 tasks.');
  const next = rows.slice();
  next.splice(index, 1, ...parts);
  return next;
}
module.exports = {MAX_TASKS, batchSchema, fromText, validateProposal, mergeNext, splitRow, explicitLocation, resolveExplicitLocation};
