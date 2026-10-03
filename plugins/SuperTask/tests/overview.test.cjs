const {test} = require('node:test');
const assert = require('node:assert/strict');
const {projectGroups, overviewRows, collapsingSelection} = require('../src/overview/model');
const projects = [{id: 'inbox', name: 'Inbox', inbox_project: true}, {id: 'home', name: 'Home'}, {id: 'empty', name: 'Empty'}];
const tasks = [{id: 'a', project_id: 'home', content: 'Later', due: {date: '2026-10-05'}},
  {id: 'b', project_id: 'home', content: 'Soon', due: {date: '2026-10-03T09:00:00Z'}},
  {id: 'c', project_id: null, content: 'Queued Inbox'}, {id: 'done', project_id: 'home', completed: true},
  {id: 'hidden', project_id: 'hidden'}];
test('overview counts active visible tasks and maps queued null-project tasks to Inbox', () => {
  const groups = projectGroups(projects, tasks);
  assert.deepEqual(groups.map(group => group.tasks.length), [1, 2, 0]);
  assert.deepEqual(groups[1].tasks.map(task => task.id), ['b', 'a']);
  assert.equal(tasks[0].id, 'a'); // no mutation of the cache array
});
test('multiple expanded projects reveal tasks inline and preserve project order', () => {
  const groups = projectGroups(projects, tasks);
  assert.equal(overviewRows(groups, {}).length, 3);
  const rows = overviewRows(groups, {inbox: true, home: true, empty: true});
  assert.deepEqual(rows.map(row => row.key), ['project:inbox', 'task:inbox:c', 'project:home',
    'task:home:b', 'task:home:a', 'project:empty', 'empty:empty']);
  assert.equal(new Set(rows.map(row => row.key)).size, rows.length);
});
test('collapsing deselects only tasks concealed by that project or all visible projects', () => {
  const groups = projectGroups(projects, tasks);
  assert.deepEqual(collapsingSelection(groups, 'home', ['a', 'c', 'other']), ['a']);
  assert.deepEqual(collapsingSelection(groups, null, ['a', 'c', 'other']), ['a', 'c']);
});
test('project filter prevents unrelated tasks or expansion state leaking into the visible overview', () => {
  const groups = projectGroups([projects[1]], tasks);
  assert.deepEqual(overviewRows(groups, {inbox: true}).map(row => row.key), ['project:home']);
});
test('same-date tasks sort by priority, then retain the fetched order', () => {
  const input = [{id: 'a', project_id: 'home', priority: 1}, {id: 'b', project_id: 'home', priority: 4},
    {id: 'c', project_id: 'home', priority: 4}];
  assert.deepEqual(projectGroups(projects, input)[1].tasks.map(task => task.id), ['b', 'c', 'a']);
});
