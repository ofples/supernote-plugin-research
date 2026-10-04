const {test} = require('node:test');
const assert = require('node:assert/strict');
const {fromText, mergeNext, splitRow, validateProposal} = require('../src/batch/model');
test('native lines become editable tasks without inventing metadata', () => {
  const rows = fromText('• Call Ofer\n\n[ ] Book train\n3. Read മലയാളം', {sectionId: null, projectId: 'p'});
  assert.deepEqual(rows.map(row => row.content), ['Call Ofer', 'Book train', 'Read മലയാളം']);
  assert.ok(rows.every(row => row.selected && row.projectId === 'p' && !row.dueString));
});
test('merge and split preserve metadata and never mutate the previous review', () => {
  const rows = fromText('Call\nOfer', {priority: 4, dueString: '2026-10-03'});
  const merged = mergeNext(rows, 0);
  assert.equal(merged[0].content, 'Call Ofer'); assert.equal(rows.length, 2);
  const split = splitRow([{...merged[0], content: 'Call Ofer\nBook train'}], 0);
  assert.deepEqual(split.map(row => row.content), ['Call Ofer', 'Book train']);
  assert.ok(split.every(row => row.priority === 4 && row.dueString === '2026-10-03'));
});
const validTask = () => ({content: 'Call Ofer', description: '', dueDate: '2026-10-04', priority: 1, sectionId: null, projectId: 'p', labels: [], explicitFields: ['location', 'dueString'], sourceRowIds: [], sourceText: 'Call Ofer in House tomorrow'});
test('structured proposals reject invented project IDs, dates and malformed details', () => {
  assert.equal(validateProposal({tasks: [validTask()]}, [{id: 'p', name: 'House'}])[0].dueString, '2026-10-04');
  for (const changes of [{sectionId: null, projectId: 'invented'}, {dueDate: 'tomorrow'}, {dueDate: '2026-02-30'},
    {priority: 0}, {content: ''}, {labels: [1]}, {unknown: 'extra'}]) {
    assert.throws(() => validateProposal({tasks: [{...validTask(), ...changes}]}, [{id: 'p'}]));
  }
  assert.throws(() => validateProposal({tasks: [], secret: 'extra'}));
  assert.throws(() => fromText(Array(101).fill('Task').join('\n')));
});
