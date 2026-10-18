function formatDueLabel(value, today) {
  if (!value) return '';
  const key = getDueDateTimeKey(value);
  const datePart = key.slice(0, 10);
  const hasTime = value.length > 10 && value[10] === 'T';
  const timePart = hasTime ? key.slice(11, 16) : '';
  const dateLabel = datePart === today ? 'Today' : `${datePart < today ? 'Overdue ' : ''}${formatDate(datePart)}`;
  return timePart ? `${dateLabel} ${timePart}` : dateLabel;
}

// Returns a sortable local-calendar key. Floating timestamps keep their wall
// clock fields; only explicit instants (Z or numeric offset) are converted.
function getDueDateTimeKey(value) {
  if (!value) return '';
  const datePart = value.slice(0, 10);
  if (value.length <= 10 || value[10] !== 'T') return `${datePart}T00:00:00.000`;

  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(value.slice(11))) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}:${pad(parsed.getSeconds())}.${String(parsed.getMilliseconds()).padStart(3, '0')}`;
    }
  }

  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?/.exec(value);
  if (!match) return `${datePart}T00:00:00.000`;
  return `${match[1]}T${match[2]}:${match[3] || '00'}.${(match[4] || '').padEnd(3, '0').slice(0, 3)}`;
}

function formatDate(dateStr) {
  const date = new Date(`${dateStr}T00:00:00`);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}

function pad(value) { return String(value).padStart(2, '0'); }

module.exports = {formatDueLabel, getDueDateTimeKey};
