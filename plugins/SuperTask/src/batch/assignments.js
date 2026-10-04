const FIELDS = {
  content: ['content'],
  description: ['description'],
  location: ['projectId', 'sectionId'],
  dueString: ['dueString'],
  priority: ['priority'],
  labels: ['labels'],
};
const BATCH_FIELDS = new Set(['location', 'dueString', 'priority', 'labels']);
const LABELS = {content: 'task title', description: 'description', location: 'project or collection', dueString: 'date', priority: 'priority', labels: 'labels'};
const copy = value => Array.isArray(value) ? [...value] : value;
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function makeDefaults(value = {}) {
  return {projectId: value.projectId || null, sectionId: value.sectionId || null,
    dueString: value.dueString || '', priority: value.priority || 1, labels: Array.isArray(value.labels) ? [...value.labels] : []};
}

function inheritDefaults(row, defaults) {
  return {...row, ...makeDefaults(defaults), labels: [...(defaults.labels || [])], overrides: {...row.overrides}, instructions: {...row.instructions}};
}

function initializeProposalRow(row, defaults) {
  const value = {...makeDefaults(defaults), ...row, sectionId: row.sectionId || null,
    overrides: {...row.overrides}, instructions: {...row.instructions}};
  for (const field of value.explicitFields || []) value.instructions[field] = true;
  const explicitLocation = value.explicitFields?.includes?.('location') || value.overrides.location || value.instructions.location;
  if (!explicitLocation && row.projectId == null) {
    value.projectId = defaults.projectId || null;
    value.sectionId = defaults.sectionId || null;
  }
  return value;
}

function changeDefault(rows, defaults, field, value) {
  if (!BATCH_FIELDS.has(field)) throw new Error(`Unknown batch field: ${field}`);
  const nextDefaults = {...defaults};
  if (field === 'location') {
    nextDefaults.projectId = value.projectId || null;
    nextDefaults.sectionId = value.sectionId || null;
  } else {
    nextDefaults[field] = copy(value);
  }
  const nextRows = rows.map(row => {
    if (!row.selected || row.overrides?.[field] || row.instructions?.[field]) return row;
    return {...row, ...Object.fromEntries(FIELDS[field].map(key => [key, copy(nextDefaults[key])]))};
  });
  return {defaults: nextDefaults, rows: nextRows};
}

function editRow(row, field, value) {
  if (!FIELDS[field]) throw new Error(`Unknown task field: ${field}`);
  const changes = field === 'location'
    ? {projectId: value.projectId || null, sectionId: value.sectionId || null}
    : {[field]: copy(value)};
  return {...row, ...changes, overrides: {...row.overrides, [field]: true}};
}

function resetRowField(row, field, defaults) {
  if (!FIELDS[field]) throw new Error(`Unknown task field: ${field}`);
  const overrides = {...row.overrides};
  delete overrides[field];
  const instructions = {...row.instructions};
  delete instructions[field];
  const values = BATCH_FIELDS.has(field)
    ? Object.fromEntries(FIELDS[field].map(key => [key, copy(defaults[key])]))
    : {};
  return {...row, ...values, overrides, instructions};
}

function copyOverridesToSplit(source, parts) {
  return parts.map(part => ({...part, overrides: {...source.overrides}, instructions: {...source.instructions},
    labels: Array.isArray(source.labels) ? [...source.labels] : part.labels}));
}

function replaceSplitParts(rows, index, parts) {
  const count = parts.length - rows.length + 1;
  if (count <= 1) return parts;
  const splitParts = copyOverridesToSplit(rows[index], parts.slice(index, index + count))
    .map(part => ({...part, rowId: undefined}));
  return [...parts.slice(0, index), ...splitParts, ...parts.slice(index + count)];
}

function mergeOverrides(left, right) {
  const merged = {...left, overrides: {...left.overrides}, instructions: {...left.instructions}};
  for (const field of Object.keys(FIELDS)) {
    const leftSet = !!left.overrides?.[field];
    const rightSet = !!right.overrides?.[field];
    const leftInstruction = !!left.instructions?.[field];
    const rightInstruction = !!right.instructions?.[field];
    const leftValue = Object.fromEntries(FIELDS[field].map(key => [key, left[key]]));
    const rightValue = Object.fromEntries(FIELDS[field].map(key => [key, right[key]]));
    if (field === 'content') {
      if (leftSet || rightSet) merged.overrides.content = true;
      continue;
    }
    if (leftSet && rightSet && !same(leftValue, rightValue)) {
      throw new Error(`These rows have different manual ${LABELS[field]} choices. Clear one choice or keep the rows separate before merging.`);
    }
    if (!leftSet && !rightSet && leftInstruction && rightInstruction && !same(leftValue, rightValue)) {
      throw new Error(`These rows have different explicit ${LABELS[field]} instructions. Keep the rows separate before merging.`);
    }
    if (!leftSet && rightSet) for (const key of FIELDS[field]) merged[key] = copy(right[key]);
    if (leftSet || rightSet) merged.overrides[field] = true;
    if (!leftSet && !rightSet && !leftInstruction && rightInstruction) for (const key of FIELDS[field]) merged[key] = copy(right[key]);
    if (leftInstruction || rightInstruction) merged.instructions[field] = true;
  }
  return merged;
}

function reconcileRefinement(rows, proposals) {
  const byId = new Map(rows.map(row => [String(row.rowId), row]));
  const sourceCounts = new Map();
  for (const proposal of proposals) for (const id of proposal.sourceRowIds || []) {
    const key = String(id);
    sourceCounts.set(key, (sourceCounts.get(key) || 0) + 1);
  }
  const hasOverrides = rows.some(row => Object.values(row.overrides || {}).some(Boolean));
  return proposals.map((proposal, index) => {
    let sources;
    if (Array.isArray(proposal.sourceRowIds)) {
      sources = proposal.sourceRowIds.map(id => byId.get(String(id)));
      if (!sources.length || sources.some(row => !row)) {
        throw new Error('AI returned an invalid row mapping. Original rows were kept.');
      }
    } else if (proposals.length === rows.length) {
      sources = [rows[index]];
    } else if (hasOverrides) {
      throw new Error('AI could not map its suggestions to your manual choices. Original rows were kept.');
    } else {
      sources = [];
    }

    const next = {...proposal};
    const overrides = {};
    for (const field of Object.keys(FIELDS)) {
      const manual = sources.filter(row => row.overrides?.[field]);
      const instructed = sources.filter(row => row.instructions?.[field]);
      const preserve = manual.length ? manual : instructed;
      if (!preserve.length) {
        if (Array.isArray(proposal.explicitFields) && proposal.explicitFields.includes(field)) overrides.__instructions = {...overrides.__instructions, [field]: true};
        continue;
      }
      if (field === 'content' && manual.length) {
        next.content = manual.map(row => String(row.content || '').trim()).filter(Boolean).join(' ');
        overrides.content = true;
        continue;
      }
      const first = Object.fromEntries(FIELDS[field].map(key => [key, preserve[0][key]]));
      if (preserve.some(row => !same(first, Object.fromEntries(FIELDS[field].map(key => [key, row[key]]))))) {
        const kind = manual.length ? 'manual' : 'explicit';
        throw new Error(`AI combined rows with different ${kind} ${LABELS[field]} choices. Original rows were kept.`);
      }
      Object.assign(next, first);
      if (manual.length) overrides[field] = true;
      else overrides.__instructions = {...overrides.__instructions, [field]: true};
    }
    const sourceId = sources.length === 1 ? String(sources[0].rowId) : '';
    const instructions = {...next.instructions, ...overrides.__instructions};
    delete overrides.__instructions;
    const uniqueSource = Array.isArray(proposal.sourceRowIds)
      ? sourceCounts.get(sourceId) === 1
      : proposals.length === rows.length;
    return {...next, rowId: sourceId && uniqueSource ? sources[0].rowId : undefined, overrides, instructions};
  });
}

module.exports = {FIELDS, makeDefaults, inheritDefaults, initializeProposalRow, changeDefault, editRow, resetRowField,
  copyOverridesToSplit, replaceSplitParts, mergeOverrides, reconcileRefinement};
