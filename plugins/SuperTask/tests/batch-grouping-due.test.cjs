const {test} = require('node:test');
const assert = require('node:assert/strict');
const {fromText, splitRow} = require('../src/batch/model');
const {groupOcrText} = require('../src/batch/ocrGrouping');
const {resolveDue, emptyStore, addBatch, commandFor} = require('../src/offline/model');

test('OCR lines preserve separate tasks and join only indented continuations', () => {
  assert.deepEqual(groupOcrText('First task\n  wrapped detail\nSecond task'), [
    {sourceText: 'First task\n  wrapped detail'}, {sourceText: 'Second task'},
  ]);
  assert.deepEqual(groupOcrText('- First task\n- Second task'), [
    {sourceText: '- First task'}, {sourceText: '- Second task'},
  ]);
});

test('paragraph mode joins wrapped lines; explicit split always uses each line', () => {
  assert.deepEqual(groupOcrText('Call vet\nabout appointment\n\nBuy food\nfor dog', 'paragraphs'), [
    {sourceText: 'Call vet\nabout appointment'}, {sourceText: 'Buy food\nfor dog'},
  ]);
  assert.deepEqual(groupOcrText('Alpha\n  wrapped\nBeta', 'paragraphs', {explicitSplit: true}), [
    {sourceText: 'Alpha'}, {sourceText: '  wrapped'}, {sourceText: 'Beta'},
  ]);
  assert.equal(splitRow([{content: 'Alpha\n  wrapped\nBeta'}], 0).length, 3);
  assert.deepEqual(groupOcrText('A\r\nB\rC', 'paragraphs'), [{sourceText: 'A\r\nB\rC'}]);
});

test('offline due serialization retains local time with a floating timezone', () => {
  assert.deepEqual(resolveDue('2026-10-18T09:30:00'), {date: '2026-10-18T09:30:00', timezone: null, is_recurring: false});
  assert.throws(() => resolveDue('2026-02-30T09:30:00'));
  assert.throws(() => resolveDue('2026-10-18T24:00:00'));
  const ids = (() => {let id = 0; return () => `id-${++id}`;})();
  const {next, tasks} = addBatch(emptyStore('account', 'device'), [{content: 'Call vet', dueString: '2026-10-18T09:30:00'}], null, ids, 1);
  assert.deepEqual(tasks[0].due, {date: '2026-10-18T09:30:00', timezone: null, is_recurring: false});
  assert.deepEqual(commandFor(next, next.outbox[0]).args.due, tasks[0].due);
});

test('existing today and tomorrow due phrases retain date-only behavior', () => {
  assert.deepEqual(resolveDue('2026-10-17', 1), {date: '2026-10-17', is_recurring: false});
  assert.equal(resolveDue('today', new Date(2026, 9, 17, 12).getTime()).date, '2026-10-17');
  assert.equal(resolveDue('tomorrow', new Date(2026, 9, 17, 12).getTime()).date, '2026-10-18');
});

test('quick-add timestamps are parsed and invalid time text remains untouched', () => {
  const [task] = fromText('Call vet due 2026-10-18 at 9:30', {}, {capturedAt: new Date(2026, 9, 17).getTime()});
  assert.equal(task.dueString, '2026-10-18T09:30:00');
  assert.equal(task.content, 'Call vet');
  const [invalid] = fromText('Call vet 2026-10-18 25:90', {});
  assert.equal(invalid.content, 'Call vet 2026-10-18 25:90');
});
