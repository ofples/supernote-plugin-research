const {test} = require('node:test');
const assert = require('node:assert/strict');
const {formatDueLabel} = require('../src/components/taskDueLabel');

test('due labels retain date-only values and display floating clock time', () => {
  assert.equal(formatDueLabel('2026-10-18', '2026-10-17'), 'Oct 18');
  assert.equal(formatDueLabel('2026-10-17T09:05:42', '2026-10-17'), 'Today 09:05');
  assert.equal(formatDueLabel('2026-10-16T23:15:00', '2026-10-17'), 'Overdue Oct 16 23:15');
});

test('timezone-bearing due timestamps display device-local time', () => {
  const value = '2026-10-18T01:05:00Z';
  const local = new Date(value);
  const expected = `Oct 18 ${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`;
  assert.equal(formatDueLabel(value, '2026-10-17'), expected);
});
