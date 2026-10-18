const {resolveDue} = require('../offline/model');

const normal = value => String(value || '').trim().toLocaleLowerCase();
const isBoundary = char => !char || /[\s,;|/()[\]{}#]/u.test(char);
const inside = (index, spans = []) => spans.some(span => index >= span.start && index < span.end);
const overlaps = (start, end, spans = []) => spans.some(span => start < span.end && end > span.start);
function protectedRanges(text) {
  return [...text.matchAll(/(?:https?:\/\/|www\.)[^\s]+/giu),
    ...text.matchAll(/[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]+@(?:[\p{L}\p{N}-]+\.)+[\p{L}\p{N}-]+/gu)]
    .map(match => ({start: match.index, end: match.index + match[0].length}));
}

function matchName(text, index, choices) {
  const value = text.slice(index);
  if (/^["“]/u.test(value)) {
    const close = value[0] === '“' ? '”' : '"';
    const end = value.indexOf(close, 1);
    if (end < 0) return {status: 'unresolved'};
    const name = value.slice(1, end);
    const matches = choices.filter(choice => normal(choice.name) === normal(name));
    if (!matches.length) return {status: 'unresolved'};
    if (matches.length !== 1) return {status: 'ambiguous'};
    return {status: 'matched', choice: matches[0], end: index + end + 1};
  }
  const matches = choices.filter(choice => {
    const name = String(choice.name || '');
    if (!name || normal(value.slice(0, name.length)) !== normal(name)) return false;
    return isBoundary(value[name.length]);
  }).sort((a, b) => b.name.length - a.name.length);
  if (!matches.length) return {status: 'unresolved'};
  const longest = matches[0].name.length;
  const finalists = matches.filter(choice => choice.name.length === longest);
  if (finalists.length !== 1) return {status: 'ambiguous'};
  return {status: 'matched', choice: finalists[0], end: index + longest};
}

function matchLocationAt(text, markerStart, markerEnd, projects, sections, mode) {
  const projectMatch = matchName(text, markerEnd, projects);
  if (projectMatch.status !== 'matched') return {status: projectMatch.status};
  let afterProject = projectMatch.end;
  while (/\s/u.test(text[afterProject] || '')) afterProject++;
  let sectionId = null, end = projectMatch.end;
  if (text[afterProject] === '/') {
    let sectionStart = afterProject + 1;
    while (/\s/u.test(text[sectionStart] || '')) sectionStart++;
    const sectionMatch = matchName(text, sectionStart, sections.filter(section => String(section.project_id) === String(projectMatch.choice.id) && !section.is_deleted && !section.is_archived));
    if (sectionMatch.status !== 'matched') return {status: sectionMatch.status};
    sectionId = String(sectionMatch.choice.id);
    end = sectionMatch.end;
  } else if (mode === 'bare' && text[afterProject] !== '/') {
    return {status: 'none'};
  }
  return {status: 'matched', value: {projectId: String(projectMatch.choice.id), sectionId}, start: markerStart, end};
}

function resolveLocationReferences(text, projects = [], sections = [], defaultProjectId = null) {
  const refs = [];
  let unresolved = false;
  const projectChoices = projects.filter(project => project?.name && !project.is_deleted && !project.is_archived);
  const protectedText = protectedRanges(text);
  for (let index = 0; index < text.length; index++) {
    if (inside(index, protectedText) || inside(index, refs)) continue;
    const char = text[index], previous = text[index - 1];
    if (char === '#' && (index === 0 || /[\s,;([{]/u.test(previous))) {
      const result = matchLocationAt(text, index, index + 1, projectChoices, sections, 'marker');
      if (result.status === 'matched') refs.push(result);
      else if (result.status === 'ambiguous' || result.status === 'unresolved') unresolved = true;
    }
    const phrase = text.slice(index).match(/^(?:project\s*:\s*|in\s+)/i);
    if (phrase && (index === 0 || isBoundary(previous))) {
      const result = matchLocationAt(text, index, index + phrase[0].length, projectChoices, sections, 'spoken');
      if (result.status === 'matched') refs.push(result);
      else if (/^project\s*:/i.test(phrase[0])) unresolved = true;
    }
  }

  // A confirmed project reference owns its whole span, including its slash and
  // collection. Bare references are considered only outside those spans.
  const hasProjectAtEnd = index => {
    const prefix = text.slice(0, index).trimEnd();
    return projectChoices.some(project => {
      const name = String(project.name || '');
      if (!name || normal(prefix.slice(-name.length)) !== normal(name)) return false;
      const start = prefix.length - name.length;
      return isBoundary(prefix[start - 1]);
    });
  };
  for (let index = 0; index < text.length; index++) {
    if (inside(index, protectedText)) continue;
    const char = text[index], previous = text[index - 1];
    if ((index === 0 || isBoundary(previous)) && char !== '#' && !inside(index, refs)) {
      const result = matchLocationAt(text, index, index, projectChoices, sections, 'bare');
      if (result.status === 'matched' && !inside(result.start, refs)) refs.push(result);
    }
  }
  const projectIds = [...new Set(refs.map(ref => String(ref.value.projectId)))];
  const effectiveProjectId = projectIds.length === 1 ? projectIds[0] : defaultProjectId;
  if (effectiveProjectId) {
    for (let index = 0; index < text.length; index++) {
      if (text[index] !== '/' || inside(index, protectedText) || inside(index, refs) || hasProjectAtEnd(index)) continue;
      let sectionStart = index + 1;
      while (/\s/u.test(text[sectionStart] || '')) sectionStart++;
      const match = matchName(text, sectionStart, sections.filter(section => String(section.project_id) === String(effectiveProjectId) && !section.is_deleted && !section.is_archived));
      if (match.status === 'matched') {
        for (const ref of refs) {
          if (String(ref.value.projectId) === String(effectiveProjectId) && !ref.value.sectionId) ref.value.sectionId = String(match.choice.id);
        }
        refs.push({status: 'matched', value: {projectId: String(effectiveProjectId), sectionId: String(match.choice.id)}, start: index, end: match.end});
      }
      else if (match.status === 'ambiguous') unresolved = true;
    }
  }

  const unique = new Map(refs.map(ref => [JSON.stringify(ref.value), ref.value]));
  if (unique.size > 1) return {location: null, spans: [], unresolved: true};
  const location = unique.size === 1 ? [...unique.values()][0] : null;
  // Only consume confirmed, non-overlapping references that all resolve to the same destination.
  const spans = location ? refs.filter(ref => JSON.stringify(ref.value) === JSON.stringify(location))
    .sort((a, b) => a.start - b.start).filter((ref, i, all) => !i || ref.start >= all[i - 1].end) : [];
  return {location, spans, unresolved};
}

function labelTokens(text, excludedSpans = []) {
  const labels = [], spans = [];
  const emailRanges = protectedRanges(text);
  const regex = /(^|[\s,;])([%@])(?:"([^"]+)"|“([^”]+)”|([\p{L}\p{N}\p{M}_-]+))/gu;
  let match;
  while ((match = regex.exec(text))) {
    const markerStart = match.index + match[1].length;
    if (inside(markerStart, emailRanges) || inside(markerStart, excludedSpans)) continue;
    const preceding = text.slice(Math.max(0, markerStart - 32), markerStart);
    if (/(?:assignee\s*[:=]?\s*|assign(?:ed)?\s+to\s+|remind(?:er)?(?:\s+me)?\s+)$/iu.test(preceding)) continue;
    const label = match[3] || match[4] || match[5];
    if (!label) continue;
    labels.push(label);
    spans.push({start: markerStart, end: regex.lastIndex});
  }
  return {labels: [...new Set(labels)], spans};
}

function parseTime(value) {
  let hour, minute;
  let second = 0;
  let match = value.match(/^(\d{1,2})(?::(\d{2})(?::(\d{2}))?)?\s*(am|pm)$/i);
  if (match) {
    hour = Number(match[1]); minute = Number(match[2] || 0); second = Number(match[3] || 0);
    if (hour < 1 || hour > 12 || minute > 59 || second > 59) return null;
    hour = (hour % 12) + (match[4].toLowerCase() === 'pm' ? 12 : 0);
  } else {
    match = value.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) return null;
    hour = Number(match[1]); minute = Number(match[2]); second = Number(match[3] || 0);
    if (hour > 23 || minute > 59 || second > 59) return null;
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
}

function parseDue(text, capturedAt = Date.now(), excludedSpans = []) {
  const candidates = [];
  const recurrence = /\b(?:every\s+(?:(?:other|second|third|fourth)\s+)?(?:\d+\s+)?(?:days?|weeks?|months?|years?|weekdays?|weekends?)|each\s+(?:day|week|month|year|weekday|weekend)|daily|weekly|monthly|yearly|annually)\b(?:\s+(?:starting|from|beginning)(?:\s+on)?\s+(?:today|tomorrow|tonight|\d{4}-\d{2}-\d{2}))?/giu;
  const reminder = /\b(?:remind(?:er)?(?:\s+me)?|deadline|alert(?:\s+me)?|notify(?:\s+me)?)\b[^.;\n]{0,64}?\b(?:today|tomorrow|tonight|\d{4}-\d{2}-\d{2})\b/giu;
  const unsupportedTemporal = [...text.matchAll(recurrence), ...text.matchAll(reminder)]
    .map(match => ({start: match.index, end: match.index + match[0].length}));
  const blocked = [...protectedRanges(text), ...excludedSpans, ...unsupportedTemporal];
  const add = (start, end, date, time) => {
    if (inside(start, blocked) || blocked.some(span => start < span.end && end > span.start)) return;
    if (text[start - 1] === '#') return;
    const dueString = time ? `${date}T${time}` : date;
    try {resolveDue(dueString, capturedAt); candidates.push({start, end, dueString});} catch {}
  };
  const relative = /\b(?:(due)\s+)?(today|tomorrow|tonight)(?:\s+at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}:\d{2}))?\b/gi;
  let match;
  while ((match = relative.exec(text))) {
    const datePhrase = match[2].toLowerCase() === 'tonight' ? 'today' : match[2].toLowerCase();
    const date = resolveDue(datePhrase, capturedAt).date;
    const time = match[3] ? parseTime(match[3].replace(/\s+/g, '')) : null;
    if (!match[3] || time) add(match.index, relative.lastIndex, date, time);
  }
  const absolute = /\b(?:(due)\s+)?(\d{4}-\d{2}-\d{2})(?:(?:[ T]|\s+at\s+)(\d{1,2}(?::\d{2}(?::\d{2})?)?\s*(?:am|pm)|\d{1,2}:\d{2}(?::\d{2})?)([zZ]|[+-]\d{2}:?\d{2})?)?(?![\p{L}\p{N}:])/giu;
  while ((match = absolute.exec(text))) {
    const suffix = text.slice(absolute.lastIndex);
    if (!match[3] && /^(?:\s+at\s+|\s+|T)\d{1,2}:\d{2}/iu.test(suffix)) continue;
    if (match[3] && !match[4] && /^(?:[zZ]|[+-]\d{2}:?\d{2})/u.test(suffix)) continue;
    // Offline due dates are local floating values. Keep explicit instants and
    // offsets intact rather than stripping their zone and changing meaning.
    if (match[4]) continue;
    let time;
    if (match[3]) {
      const parsed = parseTime(match[3].replace(/\s+/g, ''));
      if (!parsed) continue;
      time = parsed;
    }
    add(match.index, absolute.lastIndex, match[2], time);
  }
  candidates.sort((a, b) => a.start - b.start || b.end - a.end);
  const selected = candidates.filter((item, index) => !candidates.some((other, otherIndex) => otherIndex !== index &&
    other.start <= item.start && other.end >= item.end && (other.start < item.start || other.end > item.end)));
  const unique = new Map(selected.map(item => [item.dueString, item]));
  return unique.size === 1 ? [...unique.values()][0] : null;
}

function parseQuickAdd(value, {projects = [], sections = [], capturedAt = Date.now(), defaultProjectId = null} = {}) {
  const text = String(value);
  const locationResult = resolveLocationReferences(text, projects, sections, defaultProjectId);
  const tokenSpans = [...locationResult.spans];
  const labels = labelTokens(text, tokenSpans);
  tokenSpans.push(...labels.spans);
  let priority;
  const pRegex = /(^|[\s,;])p([1-4])(?=$|[\s,.;])/gi;
  let match;
  const priorities = [];
  while ((match = pRegex.exec(text))) {
    const tokenStart = match.index + match[1].length;
    const separator = match[1].match(/[,;]/u)?.[0];
    const start = separator ? match.index + match[1].indexOf(separator) : tokenStart;
    if (!overlaps(tokenStart, pRegex.lastIndex, [...tokenSpans, ...protectedRanges(text)])) priorities.push({priority: 5 - Number(match[2]), start, end: pRegex.lastIndex});
  }
  if (priorities.length && new Set(priorities.map(item => item.priority)).size === 1) {
    priority = priorities[0].priority;
    tokenSpans.push(...priorities);
  }
  const due = parseDue(text, capturedAt, [...tokenSpans, ...protectedRanges(text)]);
  if (due) tokenSpans.push(due);
  let cleaned = '', cursor = 0;
  for (const span of tokenSpans.sort((a, b) => a.start - b.start)) {
    if (span.start < cursor) continue;
    cleaned += text.slice(cursor, span.start);
    cursor = span.end;
  }
  cleaned = (cleaned + text.slice(cursor)).replace(/[\t ]+/g, ' ').replace(/\s*[,;]\s*$/, '').trim();
  return {content: cleaned, projectId: locationResult.location?.projectId, sectionId: locationResult.location?.sectionId,
    labels: labels.labels, priority, dueString: due?.dueString, unresolvedLocation: locationResult.unresolved};
}

module.exports = {parseQuickAdd, parseDue, labelTokens, resolveLocationReferences};
