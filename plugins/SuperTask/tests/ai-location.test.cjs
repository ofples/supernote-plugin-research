const {test} = require('node:test');
const assert = require('node:assert/strict');
const {explicitLocation, validateProposal} = require('../src/batch/model');
const projects = [{id: 'p', name: 'House'}, {id: 'q', name: 'Work'}];
const sections = [{id: 's', project_id: 'p', name: 'Shopping'}];
test('only explicit uniquely named locations match', () => {
  for (const text of ['sweep in House', 'sweep project: House']) assert.equal(explicitLocation(text, 'p', null, projects, sections), true);
  assert.equal(explicitLocation('bulbs in House / Shopping', 'p', 's', projects, sections), true);
  assert.equal(explicitLocation('sweep the floor', 'p', null, projects, sections), false);
  assert.equal(explicitLocation('in Houseboat', 'p', null, projects, sections), false);
  assert.equal(explicitLocation('in House', 'p', null, [...projects, {id: 'other', name: 'House'}], sections), false);
  assert.equal(explicitLocation('in House of Cards', 'p', null, [...projects, {id: 'cards', name: 'House of Cards'}], sections), false);
  assert.equal(explicitLocation('in House or project: Work', 'p', null, projects, sections), false);
});
test('AI cannot invent source mappings, omit rows or infer a location from task meaning', () => {
  const rows = [{rowId: 1, content: 'sweep floor', projectId: 'q', sectionId: null}];
  const task = {content: 'Sweep floor', description: '', dueDate: null, priority: 1, projectId: 'q', sectionId: null, labels: [], explicitFields: [], sourceRowIds: ['1'], sourceText: 'sweep floor'};
  assert.equal(validateProposal({tasks: [task]}, projects, sections, rows).length, 1);
  assert.throws(() => validateProposal({tasks: [{...task, projectId: 'p', sourceText: 'in House'}]}, projects, sections, rows), /explicit/);
  assert.throws(() => validateProposal({tasks: [{...task, sourceRowIds: ['unknown']}]}, projects, sections, rows), /invalid/);
  assert.throws(() => validateProposal({tasks: [task]}, projects, sections, [...rows, {...rows[0], rowId: 2}]), /omitted/);
  assert.equal(validateProposal({tasks: [{...task, projectId: null}]}, projects, sections, rows)[0].projectId, 'q');
});
test('image proposals keep unsupported metadata at defaults, explicit date and importance remain reviewable', () => {
  const task = {content: 'Call mom', description: '', dueDate: '2026-10-04', priority: 4, projectId: null, sectionId: null,
    labels: ['guess'], sourceRowIds: [], sourceText: 'call mom', explicitFields: ['dueString', 'priority', 'labels']};
  const result = validateProposal({tasks: [task]}, projects, sections)[0];
  assert.equal(result.dueString, ''); assert.equal(result.priority, 1); assert.deepEqual(result.labels, []);
  const explicit = validateProposal({tasks: [{...task, sourceText: 'important: call mom today', explicitFields: ['priority', 'dueString']}]}, projects, sections)[0];
  assert.equal(explicit.priority, 4); assert.equal(explicit.dueString, '2026-10-04');
});
