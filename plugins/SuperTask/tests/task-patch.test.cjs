const {test} = require('node:test');
const assert = require('node:assert/strict');
const {taskPatch} = require('../src/offline/taskPatch');
const projects = [{id: 'p', name: 'Home'}, {id: 'i', inbox_project: true}];
const sections = [{id: 's', project_id: 'p', name: 'Garden'}];
const task = {content: 'Water plants', description: '', priority: 1, labels: [], project_id: 'p', section_id: 's',
  due: {date: '2026-10-04', string: 'every day at 9am', is_recurring: true, timezone: 'Asia/Calcutta'}};
test('full unchanged recurring form only queues the edited title', () => {
  assert.deepEqual(taskPatch(task, {content: 'Water more plants', description: '', priority: 1, labels: [],
    projectId: 'p', sectionId: 's', dueString: 'every day at 9am'}, projects, sections), {content: 'Water more plants'});
});
test('explicit date clear and Inbox move are distinct from omitted fields', () => {
  assert.deepEqual(taskPatch(task, {dueString: ''}, projects, sections), {due: null});
  assert.deepEqual(taskPatch(task, {projectId: null}, projects, sections), {project_id: 'i', section_id: null});
  assert.deepEqual(taskPatch(task, {}, projects, sections), {});
});
test('a stale form collection alias resolves before form move validation', () => {
  assert.deepEqual(taskPatch(task, {sectionId: 'section:local'}, projects,
    [...sections, {id: 'real', localId: 'section:local', project_id: 'p'}]), {project_id: 'p', section_id: 'real'});
});
