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

test('nested explicit project and section references use the explicit project', () => {
  const allProjects = [...projects, {id: 'today', name: 'Today'}, {id: 'quoted', name: 'Shopping @Home P1 Today'}];
  const allSections = [...sections,
    {id: 'house-admin', project_id: 'house', name: 'Admin'},
    {id: 'work-admin', project_id: 'work', name: 'Admin'}];
  const nested = parseQuickAdd('Do task #Work /Admin', {projects: allProjects, sections: allSections, defaultProjectId: 'house'});
  assert.equal(nested.projectId, 'work');
  assert.equal(nested.sectionId, 'work-admin');
  assert.equal(nested.content, 'Do task');
  const sectionOnly = parseQuickAdd('#Work do task /Admin', {projects: allProjects, sections: allSections, defaultProjectId: 'house'});
  assert.equal(sectionOnly.projectId, 'work');
  assert.equal(sectionOnly.sectionId, 'work-admin');
});

test('metadata scanners ignore confirmed project-name spans and dates inside URLs or email addresses', () => {
  const allProjects = [...projects, {id: 'today', name: 'Today'}, {id: 'quoted', name: 'Shopping @Home P1 Today'}];
  const project = parseQuickAdd('Finish #Today task', {projects: allProjects, sections, capturedAt: new Date(2026, 0, 1).getTime()});
  assert.equal(project.projectId, 'today');
  assert.equal(project.dueString, undefined);
  const quoted = parseQuickAdd('#"Shopping @Home P1 Today"', {projects: allProjects, sections, capturedAt: new Date(2026, 0, 1).getTime()});
  assert.equal(quoted.projectId, 'quoted');
  assert.deepEqual(quoted.labels, []);
  assert.equal(quoted.priority, undefined);
  assert.equal(quoted.dueString, undefined);
  const text = 'See https://example.com/2026-10-18 and mail a@tomorrow.com';
  const protectedText = parseQuickAdd(text, {projects, sections});
  assert.equal(protectedText.content, text);
  assert.equal(protectedText.dueString, undefined);
  const unknownHash = parseQuickAdd('Wait for #Tomorrow', {projects, sections});
  assert.equal(unknownHash.content, 'Wait for #Tomorrow');
  assert.equal(unknownHash.dueString, undefined);
});

test('quick add consumes AM and PM suffixes as part of local times without leaving fragments', () => {
  const parsed = parseQuickAdd('Meet due 2026-10-18 at 9:30pm', {});
  assert.equal(parsed.content, 'Meet');
  assert.equal(parsed.dueString, '2026-10-18T21:30:00');
  const morning = parseQuickAdd('Meet 2026-10-18 12:05am', {});
  assert.equal(morning.content, 'Meet');
  assert.equal(morning.dueString, '2026-10-18T00:05:00');
  const hourOnly = parseQuickAdd('Meet due tomorrow at 9am', {capturedAt: new Date(2026, 9, 17).getTime()});
  assert.equal(hourOnly.content, 'Meet');
  assert.equal(hourOnly.dueString, '2026-10-18T09:00:00');
});

test('quick add does not partially consume malformed AM/PM or time tokens', () => {
  for (const time of ['9:30pmm', '9:30abc']) {
    const text = `Meet due 2026-10-18 at ${time}`;
    const parsed = parseQuickAdd(text, {});
    assert.equal(parsed.content, text);
    assert.equal(parsed.dueString, undefined);
  }
});

test('quick add preserves explicit ISO instants instead of partially consuming their zone suffix', () => {
  for (const value of ['2026-10-18T09:30:00Z', '2026-10-18T09:30:00+05:30']) {
    const text = `Meet due ${value}`;
    const parsed = parseQuickAdd(text, {});
    assert.equal(parsed.content, text);
    assert.equal(parsed.dueString, undefined);
  }
});

test('unsupported recurrence, reminder, and deadline dates remain visible instead of becoming one-time due dates', () => {
  for (const text of ['Water every day starting tomorrow', 'Remind me tomorrow to call', 'Set deadline: 2026-10-18']) {
    const parsed = parseQuickAdd(text, {});
    assert.equal(parsed.content, text);
    assert.equal(parsed.dueString, undefined);
  }
});

test('conflicting priorities remain in source text and do not select either value', () => {
  const conflict = parseQuickAdd('Handle this p1 p2', {});
  assert.equal(conflict.content, 'Handle this p1 p2');
  assert.equal(conflict.priority, undefined);
  const repeated = parseQuickAdd('Handle this p2, p2', {});
  assert.equal(repeated.content, 'Handle this');
  assert.equal(repeated.priority, 3);
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

test('AI cannot treat metadata words inside a quoted project as source due, priority or labels', () => {
  const project = {id: 'quoted', name: 'Shopping @Home P1 Today'};
  const sourceText = '#"Shopping @Home P1 Today" Buy groceries';
  const source = {rowId: 'r1', content: 'Buy groceries', sourceText, projectId: null, sectionId: null,
    priority: 1, dueString: '', labels: []};
  const proposal = {content: 'Buy groceries', description: '', dueDate: '2026-10-19', priority: 4,
    projectId: 'quoted', sectionId: null, labels: ['Home'], sourceRowIds: ['r1'], sourceText,
    explicitFields: ['location', 'dueString', 'priority', 'labels']};
  const [result] = validateProposal({tasks: [proposal]}, [project], [], [source]);
  assert.equal(result.projectId, 'quoted');
  assert.equal(result.dueString, '');
  assert.equal(result.priority, 1);
  assert.deepEqual(result.labels, []);
});
