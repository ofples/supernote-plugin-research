/* Native recognition is the baseline. AI proposals must pass the same review. */
const {resolveDue} = require('../offline/model');
const {MAX_SOURCE_ROW_LENGTH, MAX_TRANSCRIPTION_LENGTH, stripBullet, splitTitleDescription} = require('./descriptionParser');
const {parseQuickAdd, resolveLocationReferences} = require('./quickAdd');
const {groupOcrText} = require('./ocrGrouping');
const MAX_TASKS = 100;
function hasDueCue(text) {
  const matcher = /\b(?:today|tomorrow|tonight|next|every|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|due)\b|\d{4}-\d{2}-\d{2}/gi;
  let match;
  while ((match = matcher.exec(text))) if (text[match.index - 1] !== '#') return true;
  return false;
}
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

function fromText(text, defaults = {}, options = {}) {
  const transcription = String(text);
  if (transcription.length > MAX_TRANSCRIPTION_LENGTH) {
    throw new Error('The transcription is too large to review.');
  }
  const groups = groupOcrText(transcription, options.grouping || 'lines', options);
  if (groups.length > MAX_TASKS) {
    throw new Error('Select at most 100 tasks at a time.');
  }
  return groups.map(({sourceText}) => {
    if (sourceText.length > MAX_SOURCE_ROW_LENGTH) {
      throw new Error('A transcription row is too long to review.');
    }
    const quickAddInput = stripBullet(sourceText).replace(/[\t ]*\r?\n[\t ]*/g, ' ');
    const quickAdd = parseQuickAdd(quickAddInput, {projects: options.projects || [], sections: options.sections || [],
      capturedAt: options.capturedAt ?? Date.now(), defaultProjectId: defaults.projectId || null});
    const parsed = splitTitleDescription(quickAdd.content);
    const instructions = {...(defaults.instructions || {})};
    const metadata = {};
    if (quickAdd.projectId !== undefined) {
      metadata.projectId = quickAdd.projectId; metadata.sectionId = quickAdd.sectionId;
      instructions.location = true;
    }
    if (quickAdd.priority !== undefined) {metadata.priority = quickAdd.priority; instructions.priority = true;}
    if (quickAdd.dueString !== undefined) {metadata.dueString = quickAdd.dueString; instructions.dueString = true;}
    if (quickAdd.labels.length) {metadata.labels = [...new Set([...(defaults.labels || []), ...quickAdd.labels])]; instructions.labels = true;}
    return {priority: 1, dueString: '',
      projectId: null, sectionId: null, labels: [], ...defaults, ...metadata,
      content: parsed.content, description: parsed.split ? parsed.description : (defaults.description || ''),
      sourceText, quickAdd: {rawText: sourceText, content: quickAdd.content, unresolvedLocation: quickAdd.unresolvedLocation},
      instructions, sourceRowIds: [], fieldProvenance: {content: 'transcription',
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
        !(task.dueDate === null || (typeof task.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2})?$/.test(task.dueDate))) ||
        !Array.isArray(task.labels) || task.labels.length > 20 ||
        task.labels.some(label => typeof label !== 'string' || !label.trim() || label.length > 100)) {
      throw new Error('AI returned invalid task details. Your original rows are unchanged.');
    }
    if (task.dueDate) resolveDue(task.dueDate);
    const sources = rows.filter(row => task.sourceRowIds.includes(String(row.rowId)));
    const sourceText = sources.length ? sources.map(row => row.sourceText || row.content).join('\n') : task.sourceText;
    const inherited = sources.length && sources.every(row => (row.projectId || null) === task.projectId &&
      (row.sectionId || null) === task.sectionId);
    const baselineProjectId = sources.length && sources.every(row => (row.projectId || null) === (sources[0].projectId || null)) ? sources[0].projectId : null;
    const location = resolveExplicitLocation(sourceText, projects, sections, baselineProjectId);
    const sourceTokens = parseQuickAdd(sourceText, {projects, sections, defaultProjectId: baselineProjectId});
    if ((task.explicitFields.includes('location') || (task.projectId !== null && (!sources.length || !inherited))) &&
        (location ? location.projectId !== task.projectId || location.sectionId !== task.sectionId : task.projectId !== null || task.sectionId !== null)) {
      throw new Error('AI location must match an explicit, unambiguous project or collection phrase. Original rows are unchanged.');
    }
    const next = {...task, content: task.content.trim(), dueString: task.dueDate || '', selected: true,
      sourceText, fieldProvenance: {content: 'ai-proposal', description: 'ai-proposal'}};
    const sourceLabels = [...new Set((sources.length ? sources : [{sourceText}]).flatMap(row =>
      parseQuickAdd(row.sourceText || row.content, {projects, sections, defaultProjectId: baselineProjectId}).labels))];
    const labelSet = values => [...new Set(values)].sort();
    if (task.explicitFields.includes('labels') && sourceLabels.length && JSON.stringify(labelSet(task.labels)) !== JSON.stringify(labelSet(sourceLabels))) {
      throw new Error('AI labels must match explicit %label or @label tokens. Original rows are unchanged.');
    }
    const sourcePriority = sourceTokens.priority ?? (/\b(?:important|urgent)\b/i.test(sourceTokens.content) ? 4 : null);
    if (task.explicitFields.includes('priority') && sourcePriority !== null && task.priority !== sourcePriority) {
      throw new Error('AI priority must match the source priority instruction. Original rows are unchanged.');
    }
    const proof = {location: !!location, dueString: !!sourceTokens.dueString || hasDueCue(sourceTokens.content),
      priority: sourcePriority !== null || /\bpriority\b/i.test(sourceText), labels: sourceLabels.length > 0};
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
function resolveExplicitLocation(text, projects, sections, defaultProjectId = null) {
  return resolveLocationReferences(String(text), projects, sections, defaultProjectId).location;
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
  const parts = fromText(row.content, row, {explicitSplit: true}).map(part => ({...part, sourceText: row.sourceText || row.content,
    sourceRowIds: [...(row.sourceRowIds || [])]}));
  if (parts.length < 2) throw new Error('Insert a line break in the title, then split.');
  if (rows.length - 1 + parts.length > MAX_TASKS) throw new Error('A batch can contain at most 100 tasks.');
  const next = rows.slice();
  next.splice(index, 1, ...parts);
  return next;
}
module.exports = {MAX_TASKS, batchSchema, fromText, validateProposal, mergeNext, splitRow, explicitLocation, resolveExplicitLocation};
