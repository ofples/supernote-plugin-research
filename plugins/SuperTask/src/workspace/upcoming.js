const {localDate} = require('../offline/model');
// Monday-Sunday calendar week, using local calendar arithmetic across DST.
function isUpcomingThisWeek(date, today) {
  const due = String(date || '').slice(0, 10);
  const end = new Date(today + 'T00:00:00');
  end.setDate(end.getDate() + (7 - end.getDay()) % 7);
  return /^\d{4}-\d{2}-\d{2}$/.test(due) && due > today && due <= localDate(end);
}
module.exports = {isUpcomingThisWeek};
