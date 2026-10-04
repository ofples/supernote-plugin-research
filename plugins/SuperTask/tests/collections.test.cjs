const {test} = require('node:test');
const assert = require('node:assert/strict');
const m = require('../src/offline/model');
const {projectSections, collectionGroups, locationChange} = require('../src/collections/model');
const {projectGroups, overviewRows} = require('../src/overview/model');
const {validateProposal} = require('../src/batch/model');
const projects = [{id: 'inbox', name: 'Inbox', inbox_project: true}, {id: 'p', name: 'Home'}, {id: 'q', name: 'Work'}];
const sections = [{id: 's2', project_id: 'p', name: 'Garden', section_order: 2},
  {id: 's1', project_id: 'p', name: 'Shopping', section_order: 1},
  {id: 'qs', project_id: 'q', name: 'Shopping'}, {id: 'gone', project_id: 'p', is_deleted: true},
  {id: 'archived', project_id: 'p', is_archived: true}];
let sequence = 0; const ids = () => `id-${++sequence}`;
const initial = () => ({...m.emptyStore('account', 'device'), projects, sections});
test('older private stores load without sections; malformed section cache is rejected', () => {
  const old = initial(); delete old.sections;
  assert.equal(m.validateStore(old, 'account', 'device'), old);
  assert.throws(() => m.validateStore({...old, sections: {}}, 'account', 'device'), /damaged/);
  const fresh = m.replaceRemote(old, [], projects, 100, sections);
  assert.deepEqual(fresh.sections, sections); assert.equal(old.sections, undefined);
});
test('collections retain Todoist order, empty collections and unknown tasks without misfiling', () => {
  assert.deepEqual(projectSections(sections, 'p').map(s => s.id), ['s1', 's2']);
  assert.deepEqual(projectSections([{id: 'a', project_id: 'p', order_key: 'aa'}, {id: 'Z', project_id: 'p', order_key: 'aZ'}], 'p').map(s => s.id), ['Z', 'a']);
  const tasks = [{id: 'a', project_id: 'p', section_id: 's2'}, {id: 'b', project_id: 'p'},
    {id: 'c', project_id: 'p', section_id: 'missing'}, {id: 'd', project_id: 'p', section_id: 'qs'}];
  const groups = collectionGroups('p', tasks, sections);
  assert.deepEqual(groups.map(g => [g.name, g.tasks.length]), [['No collection', 1], ['Shopping', 0], ['Garden', 1], ['Unavailable collections', 2]]);
  const rows = overviewRows(projectGroups(projects, tasks, sections), {p: true});
  assert.equal(rows.filter(r => r.type === 'task').length, 4);
  assert.equal(new Set(rows.map(r => r.key)).size, rows.length);
  assert.equal(rows.find(r => r.type === 'project' && r.project.id === 'p').tasks.length, 4);
});
test('queued creates freeze section ID through lost responses and cannot be redirected after send', () => {
  const added = m.addBatch(initial(), [{content: 'Water plants', projectId: 'p', sectionId: 's2'}], null, ids);
  const task = added.tasks[0];
  const sending = m.markSending(added.next, added.next.outbox);
  const command = m.commandFor(sending, sending.outbox[0]);
  assert.equal(command.args.section_id, 's2');
  const failed = m.failOperations(sending, sending.outbox, new Error('Lost response'));
  assert.deepEqual(m.commandFor(failed, failed.outbox[0]), command);
  assert.throws(() => m.editUnsent(failed, task.id, {content: task.content, projectId: 'q', sectionId: 'qs'}), /Resolve/);
  assert.throws(() => m.addBatch(initial(), [{content: 'Wrong', projectId: 'p', sectionId: 'qs'}], null, ids), /unavailable/);
  const edited = m.editUnsent(added.next, task.id, {content: task.content, projectId: 'p', sectionId: null});
  assert.equal(m.commandFor(edited, edited.outbox[0]).args.section_id, undefined);
});
test('location changes preserve collection for unrelated edits, clear it across projects, and resolve Inbox explicitly', () => {
  const task = {project_id: 'p', section_id: 's2'};
  assert.equal(locationChange(task, {}, projects, sections).changed, false);
  assert.equal(locationChange(task, {projectId: 'p', sectionId: 's2'}, projects, sections).changed, false);
  assert.deepEqual(locationChange(task, {sectionId: null}, projects, sections).body, {project_id: 'p'});
  assert.deepEqual(locationChange(task, {projectId: 'q'}, projects, sections).body, {project_id: 'q'});
  assert.deepEqual(locationChange(task, {projectId: 'q', sectionId: 'qs'}, projects, sections).body, {section_id: 'qs'});
  assert.deepEqual(locationChange(task, {projectId: null}, projects, sections).body, {project_id: 'inbox'});
  assert.throws(() => locationChange(task, {sectionId: 'qs'}, projects, sections), /unavailable/);
  assert.equal(locationChange({project_id: null}, {}, [], []).changed, false);
});
test('structured AI proposals only accept active collections in the selected project', () => {
  const task = {content: 'Water plants', description: '', dueDate: null, priority: 1, projectId: 'p', sectionId: 's2', labels: [], explicitFields: ['location', 'dueString'], sourceRowIds: [], sourceText: 'Water plants in Home / Garden'};
  assert.equal(validateProposal({tasks: [task]}, projects, sections)[0].sectionId, 's2');
  for (const changes of [{sectionId: 'qs'}, {sectionId: 'invented'}, {sectionId: 'archived'}, {projectId: null}, {sectionId: 123}]) {
    assert.throws(() => validateProposal({tasks: [{...task, ...changes}]}, projects, sections), /invalid/);
  }
});
