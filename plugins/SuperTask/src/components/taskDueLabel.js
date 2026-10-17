function formatDueLabel(value, today) {
  if (!value) return '';
  const datePart = value.slice(0, 10);
  let timePart = '';

  if (value.length > 10 && value[10] === 'T') {
    const time = value.slice(11);
    if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(time)) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        timePart = `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
      }
    } else if (/^\d{2}:\d{2}/.test(time)) {
      timePart = time.slice(0, 5);
    }
  }

  const dateLabel = datePart === today ? 'Today' : `${datePart < today ? 'Overdue ' : ''}${formatDate(datePart)}`;
  return timePart ? `${dateLabel} ${timePart}` : dateLabel;
}

function formatDate(dateStr) {
  const date = new Date(`${dateStr}T00:00:00`);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}

function pad(value) { return String(value).padStart(2, '0'); }

module.exports = {formatDueLabel};
