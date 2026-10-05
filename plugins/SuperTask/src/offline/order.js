/* Todoist v1 order_key is a lexicographic fractional index, not child_order.
 * Generate one bounded key; never renumber unrelated siblings. */
const digits = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function integerLength(key) {
  const head = key[0];
  if (head >= 'a' && head <= 'z') {return head.charCodeAt(0) - 97 + 2;}
  if (head >= 'A' && head <= 'Z') {return 90 - head.charCodeAt(0) + 2;}
  throw new Error('Unsupported Todoist order key. Refresh task ordering first.');
}
function valid(key) {
  if (typeof key !== 'string' || !key || key.length > 128) {throw new Error('Task ordering is unavailable. Refresh migrated Todoist order keys first.');}
  const length = integerLength(key);
  if (key.length < length || [...key.slice(1)].some(c => !digits.includes(c)) || (key.length > length && key.endsWith('0'))) {throw new Error('Unsupported Todoist order key.');}
  return length;
}
function priorInteger(key) {
  const length = valid(key), chars = [...key.slice(0, length)];
  for (let i = chars.length - 1; i > 0; i--) {
    const index = digits.indexOf(chars[i]);
    if (index > 0) {chars[i] = digits[index - 1]; return chars.join('');}
    chars[i] = 'z';
  }
  const head = chars[0];
  if (head === 'A') {throw new Error('Todoist order key space is exhausted.');}
  if (head === 'a') {return 'Zz';}
  const previous = String.fromCharCode(head.charCodeAt(0) - 1);
  return previous + 'z'.repeat(integerLength(previous) - 1);
}
function between(left, right) {
  if (left !== null) {valid(left);}
  if (right !== null) {valid(right);}
  if (left !== null && right !== null && left >= right) {throw new Error('Todoist sibling keys conflict. Refresh ordering first.');}
  if (left === null) {return right === null ? 'a0' : priorInteger(right) + 'V';}
  const candidate = left + 'V';
  if (right === null || candidate < right) {valid(candidate); return candidate;}
  let common = 0;
  while (left[common] && left[common] === right[common]) {common++;}
  // Same integer, smaller fractional digits: append to the complete left key
  // when its next digit is already below right. Otherwise bisect the suffix.
  const prefix = right.slice(0, common), suffix = right.slice(common);
  if (!left.slice(common)) {
    let extra = '';
    for (const c of suffix) {
      const index = digits.indexOf(c);
      if (index === 1) {const value = prefix + extra + '0V'; valid(value); if (left < value && value < right) {return value;}}
      if (index > 1) {const value = prefix + extra + digits[Math.floor(index / 2)]; valid(value); if (left < value && value < right) {return value;}}
      extra += '0';
    }
  }
  throw new Error('These Todoist order keys need reconciliation. Refresh ordering before moving the task.');
}
const scopeOf = task => JSON.stringify([task.project_id || null, task.section_id || null, task.parent_id || null]);
function siblings(store, task, model) {
  return model.mergedTasks(store).filter(t => !t.completed && !t.deleted && scopeOf(t) === scopeOf(task)).sort((a, b) => {
    if (a.order_key && b.order_key) {return a.order_key < b.order_key ? -1 : a.order_key > b.order_key ? 1 : a.id.localeCompare(b.id);}
    return (a.child_order || 0) - (b.child_order || 0) || a.id.localeCompare(b.id);
  });
}
function reorder(store, id, direction, ids, model) {
  if (!['up', 'down'].includes(direction)) {throw new Error('Choose Up or Down.');}
  const next = model.clone(store), task = model.ownTask(next, id), rows = siblings(next, task, model);
  const index = rows.findIndex(t => t.id === task.id || t.id === task.remoteId);
  const target = index + (direction === 'up' ? -1 : 1);
  if (index < 0 || target < 0 || target >= rows.length) {return next;}
  rows.forEach(t => valid(t.order_key));
  const remaining = rows.filter((_, i) => i !== index);
  const left = remaining[target - 1]?.order_key || null, right = remaining[target]?.order_key || null;
  const key = between(left, right), ops = next.outbox.filter(op => op.localId === task.id);
  const tail = ops.at(-1), baseline = rows.map(t => ({id: t.remoteId || t.id, scope: scopeOf(t), order_key: t.order_key}));
  task.order_key = key;
  if (tail?.kind === 'reorder' && !tail.attempts) {tail.order.order_key = key;}
  else {next.outbox.push({uuid: ids(), kind: 'reorder', localId: task.id, state: 'pending', attempts: 0, retryAt: 0, error: null, command: null, order: {order_key: key, baseline}});}
  return next;
}
function preflight(store, op, model) {
  const task = store.tasks[op.localId], remote = store.remote.find(t => t.id === task.remoteId);
  const rows = remote ? siblings({...store, tasks: {}}, remote, model).map(t => ({id: t.id, scope: scopeOf(t), order_key: t.order_key})) : [];
  const baseline = op.order.baseline.map(t => ({...t, id: model.findTask(store, t.id)?.remoteId || t.id}));
  if (JSON.stringify(rows) !== JSON.stringify(baseline)) {
    store.conflictArchive.push({localId: task.id, desired: model.clone(task), operations: [model.clone(op)]});
    store.syncNotices.push({localId: task.id, message: 'Sibling membership or ordering changed on Todoist. The Todoist order was kept.'});
    store.outbox = store.outbox.filter(o => o.uuid !== op.uuid);
    if (remote) {task.order_key = remote.order_key;}
  }
  if (remote) {
    // Reordering must preserve independent remote title/date/label edits.
    // Keep later durable local field intents projected over the new baseline.
    task.baseRemote = model.remoteState(remote);
    for (const key of ['content', 'description', 'priority', 'labels', 'due', 'project_id', 'section_id', 'parent_id']) {
      if (!store.outbox.some(o => o.localId === task.id && o.patch && Object.prototype.hasOwnProperty.call(o.patch, key))) {
        task[key] = remote[key] === undefined ? ['description'].includes(key) ? '' : ['labels'].includes(key) ? [] : null : model.clone(remote[key]);
      }
    }
  }
}
module.exports = {between, reorder, preflight, scopeOf, siblings};
