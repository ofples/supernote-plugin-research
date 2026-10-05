const {test} = require('node:test');
const assert = require('node:assert/strict');
const {fromText, mergeNext, splitRow, validateProposal} = require('../src/batch/model');
const {splitTitleDescription} = require('../src/batch/descriptionParser');
test('native lines become editable tasks without inventing metadata', () => {
  const rows = fromText('• Call Ofer\n\n[ ] Book train\n3. Read മലയാളം', {sectionId: null, projectId: 'p'});
  assert.deepEqual(rows.map(row => row.content), ['Call Ofer', 'Book train', 'Read മലയാളം']);
  assert.ok(rows.every(row => row.selected && row.projectId === 'p' && !row.dueString));
});
test('transcription splits only at the first spaced dash and keeps raw text and independent field provenance', () => {
  const rows = fromText('• feed dogs - one bowl - each\n- buy low-fat food – for breakfast — check expiry\n3. Move meeting 2026-10-05 - 2026-10-07');
  assert.deepEqual(rows.map(({content, description}) => [content, description]), [
    ['feed dogs', 'one bowl - each'],
    ['buy low-fat food', 'for breakfast — check expiry'],
    ['Move meeting 2026-10-05 - 2026-10-07', ''],
  ]);
  assert.equal(rows[0].sourceText, '• feed dogs - one bowl - each');
  assert.deepEqual(rows[0].fieldProvenance, {content: 'transcription', description: 'transcription'});
  assert.deepEqual(rows[2].fieldProvenance, {content: 'transcription', description: 'empty'});
});
test('parser preserves bullet-only leading markers, subtraction, ranges, unspaced hyphens and malformed empty sides', () => {
  assert.deepEqual(splitTitleDescription(' - one bowl'), {content: 'one bowl', description: '', split: false});
  assert.deepEqual(splitTitleDescription('Compare 5 - 3'), {content: 'Compare 5 - 3', description: '', split: false});
  assert.deepEqual(splitTitleDescription('-5 - 3'), {content: '-5 - 3', description: '', split: false});
  assert.deepEqual(splitTitleDescription('Move 2026-10-05 - 2026-10-07'), {content: 'Move 2026-10-05 - 2026-10-07', description: '', split: false});
  assert.deepEqual(splitTitleDescription('buy low-fat yogurt'), {content: 'buy low-fat yogurt', description: '', split: false});
  assert.deepEqual(splitTitleDescription('Write "keep this - exact phrase" - finish the note'), {
    content: 'Write "keep this - exact phrase"', description: 'finish the note', split: true,
  });
  assert.deepEqual(splitTitleDescription("Don't forget - take the key"), {
    content: "Don't forget", description: 'take the key', split: true,
  });
  assert.deepEqual(splitTitleDescription('October 2026 - November 2026'), {content: 'October 2026 - November 2026', description: '', split: false});
  assert.deepEqual(splitTitleDescription('Task - '), {content: 'Task -', description: '', split: false});
  assert.throws(() => splitTitleDescription('x'.repeat(8001)), /too long/);
});
test('merge and split preserve metadata and never mutate the previous review', () => {
  const rows = fromText('Call\nOfer', {priority: 4, dueString: '2026-10-03'});
  const merged = mergeNext(rows, 0);
  assert.equal(merged[0].content, 'Call Ofer'); assert.equal(rows.length, 2);
  assert.equal(merged[0].sourceText, 'Call\nOfer');
  assert.deepEqual(merged[0].fieldProvenance, {content: 'manual', description: 'empty'});
  const split = splitRow([{...merged[0], content: 'Call Ofer\nBook train'}], 0);
  assert.deepEqual(split.map(row => row.content), ['Call Ofer', 'Book train']);
  assert.ok(split.every(row => row.priority === 4 && row.dueString === '2026-10-03'));
});
test('merge and split retain transcription and source-row provenance', () => {
  const rows = fromText('Plan - first detail\nFollow up - second detail').map((row, index) => ({...row, rowId: `r${index + 1}`, sourceRowIds: [`r${index + 1}`]}));
  const merged = mergeNext(rows, 0)[0];
  assert.equal(merged.sourceText, 'Plan - first detail\nFollow up - second detail');
  assert.deepEqual(merged.sourceRowIds, ['r1', 'r2']);
  assert.equal(merged.description, 'first detail\nsecond detail');
  const split = splitRow([{...merged, content: 'Plan - first detail\nFollow up - second detail'}], 0);
  assert.deepEqual(split.map(row => row.sourceText), [merged.sourceText, merged.sourceText]);
  assert.deepEqual(split.map(row => row.sourceRowIds), [['r1', 'r2'], ['r1', 'r2']]);
});
const validTask = () => ({content: 'Call Ofer', description: '', dueDate: '2026-10-04', priority: 1, sectionId: null, projectId: 'p', labels: [], explicitFields: ['location', 'dueString'], sourceRowIds: [], sourceText: 'Call Ofer in House tomorrow'});
test('structured proposals reject invented project IDs, dates and malformed details', () => {
  const validated = validateProposal({tasks: [validTask()]}, [{id: 'p', name: 'House'}])[0];
  assert.equal(validated.dueString, '2026-10-04');
  assert.deepEqual(validated.fieldProvenance, {content: 'ai-proposal', description: 'ai-proposal'});
  const source = {rowId: 'r1', content: 'feed dogs', description: 'one bowl', sourceText: 'feed dogs - one bowl each - morning', dueString: '', projectId: null, sectionId: null};
  const mapped = validateProposal({tasks: [{...validTask(), projectId: null, sourceRowIds: ['r1'], sourceText: 'rewritten'}]}, [], [], [source])[0];
  assert.equal(mapped.sourceText, source.sourceText);
  for (const changes of [{sectionId: null, projectId: 'invented'}, {dueDate: 'tomorrow'}, {dueDate: '2026-02-30'},
    {priority: 0}, {content: ''}, {labels: [1]}, {unknown: 'extra'}]) {
    assert.throws(() => validateProposal({tasks: [{...validTask(), ...changes}]}, [{id: 'p'}]));
  }
  assert.throws(() => validateProposal({tasks: [], secret: 'extra'}));
  assert.throws(() => fromText(Array(101).fill('Task').join('\n')));
});
