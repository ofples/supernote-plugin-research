const {test} = require('node:test');
const assert = require('node:assert/strict');
const {fromText, resolveExplicitLocation, validateProposal} = require('../src/batch/model');
const {parseQuickAdd} = require('../src/batch/quickAdd');

const projects = [{id: 'house', name: 'House'}, {id: 'cleaning', name: 'House Cleaning'}, {id: 'work', name: 'Work'}];
const sections = [{id: 'daily', project_id: 'cleaning', name: 'Daily Cleaning'}, {id: 'inbox', project_id: 'house', name: 'Inbox'}];

test('quick add matches unique longest multiword locations and keeps the original source exactly', () => {
  const raw = '  Feed dog #"House Cleaning" /"Daily Cleaning" %care p1  ';
  const [task] = fromText(raw, {}, {projects, sections, capturedAt: new Date(2026, 0, 1).getTime()});
  assert.equal(task.sourceText, raw);
  assert.equal(task.content, 'Feed dog');
  assert.equal(task.projectId, 'cleaning');
  assert.equal(task.sectionId, 'daily');
  assert.equal(task.priority, 4);
  assert.deepEqual(task.labels, ['care']);
  assert.deepEqual(task.instructions, {location: true, priority: true, labels: true});
});

test('quick add supports spoken destinations, unquoted longest names, and section-only defaults', () => {
  assert.deepEqual(parseQuickAdd('Plan House Cleaning /Daily Cleaning', {projects, sections}).projectId, 'cleaning');
  const spoken = parseQuickAdd('Sweep in House', {projects, sections});
  assert.equal(spoken.projectId, 'house');
  assert.equal(spoken.content, 'Sweep');
  assert.equal(resolveExplicitLocation('prepare project: Work', projects, sections).projectId, 'work');
  const section = parseQuickAdd('Buy soap /Inbox', {projects, sections, defaultProjectId: 'house'});
  assert.equal(section.projectId, 'house');
  assert.equal(section.sectionId, 'inbox');
});

test('unknown or ambiguous location references remain in the title for later review', () => {
  const unknown = fromText('Call #Unknown Project', {}, {projects, sections})[0];
  assert.equal(unknown.content, 'Call #Unknown Project');
  assert.equal(unknown.quickAdd.unresolvedLocation, true);
  const duplicate = parseQuickAdd('Call #House', {projects: [...projects, {id: 'other', name: 'House'}], sections});
  assert.equal(duplicate.content, 'Call #House');
  assert.equal(duplicate.projectId, undefined);
  assert.equal(duplicate.unresolvedLocation, true);
  const badSection = parseQuickAdd('Call #House /Missing', {projects, sections});
  assert.equal(badSection.content, 'Call #House /Missing');
  assert.equal(badSection.unresolvedLocation, true);
});

test('quick add does not read Unicode text, email addresses, or URLs as metadata by accident', () => {
  const text = 'தமிழ் notes Zoë https://example.com/#House jane@example.com';
  const parsed = parseQuickAdd(text, {projects, sections});
  assert.equal(parsed.content, text);
  assert.equal(parsed.labels.length, 0);
  assert.equal(parsed.projectId, undefined);
  const label = parseQuickAdd('தமிழ் note %வீடு @घर', {projects, sections});
  assert.deepEqual(label.labels, ['வீடு', 'घर']);
});

test('unsupported assignment and reminder references stay visible for review', () => {
  const assignment = parseQuickAdd('Send report assigned to @alex', {projects, sections});
  assert.equal(assignment.content, 'Send report assigned to @alex');
  assert.deepEqual(assignment.labels, []);
  const reminder = parseQuickAdd('Remind me @alex to call', {projects, sections});
  assert.equal(reminder.content, 'Remind me @alex to call');
});

test('priority and labels map only from supported tokens and never treat #Project as a label', () => {
  for (const [token, expected] of [['p1', 4], ['p2', 3], ['p3', 2], ['p4', 1]]) {
    assert.equal(parseQuickAdd(`Task ${token}`, {}).priority, expected);
  }
  const [task] = fromText('Task #House %urgent @later', {}, {projects, sections});
  assert.equal(task.projectId, 'house');
  assert.deepEqual(task.labels, ['urgent', 'later']);
  const source = {rowId: 'r1', content: 'Task', sourceText: 'Task #House %care', projectId: null, sectionId: null, priority: 1, dueString: '', labels: []};
  const proposal = {content: 'Task', description: '', dueDate: null, priority: 1, projectId: 'house', sectionId: null,
    labels: ['House'], sourceRowIds: ['r1'], sourceText: source.sourceText, explicitFields: ['location', 'labels']};
  assert.throws(() => validateProposal({tasks: [proposal]}, projects, sections, [source]), /%label or @label/);
});

test('AI cannot erase a resolved destination by explicitly proposing Inbox', () => {
  const source = {rowId: 'r1', content: 'Task', sourceText: 'Task #House', projectId: null, sectionId: null, priority: 1, dueString: '', labels: []};
  const proposal = {content: 'Task', description: '', dueDate: null, priority: 1, projectId: null, sectionId: null,
    labels: [], sourceRowIds: ['r1'], sourceText: source.sourceText, explicitFields: ['location']};
  assert.throws(() => validateProposal({tasks: [proposal]}, projects, sections, [source]), /must match an explicit/);
});
