const {test} = require('node:test');
const assert = require('node:assert/strict');
const {isUpcomingThisWeek} = require('../src/workspace/upcoming');
test('Upcoming excludes unscheduled, overdue, today and dates beyond Sunday', () => {
  for (const date of [null, '', '2026-10-04', '2026-10-05', '2026-10-12']) assert.equal(isUpcomingThisWeek(date, '2026-10-05'), false);
  for (const date of ['2026-10-06', '2026-10-11', '2026-10-11T10:00:00']) assert.equal(isUpcomingThisWeek(date, '2026-10-05'), true);
  assert.equal(isUpcomingThisWeek('2026-10-12', '2026-10-11'), false);
});
