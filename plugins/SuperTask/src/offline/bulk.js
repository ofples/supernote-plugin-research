/* One reducer = one durable transaction. Request IDs survive uncertain replies. */
function mutate(store, taskIds, mutation, ids, requestId, model) {
  if (!Array.isArray(taskIds) || !taskIds.length) {throw new Error('Select at least one task.');}
  const selected = [...new Set(taskIds)], signature = JSON.stringify({selected, mutation});
  const prior = store.mutationRequests?.[requestId];
  if (prior) {
    if (prior.signature !== signature) {throw new Error('A pending mutation identity cannot be reused for different changes.');}
    return {next: model.clone(store), results: prior.results};
  }
  let next = model.clone(store); const results = [];
  for (const id of selected) {
    const task = model.findTask(next, id);
    if (!task || task.deleted) {throw new Error('A selected task is unavailable. Review the selection again.');}
    if (mutation.kind === 'edit') {next = model.editTask(next, id, mutation.patch || {}, ids);}
    else if (mutation.kind === 'complete') {next = model.setCompleted(next, id, !!mutation.completed, ids);}
    else if (mutation.kind === 'delete') {next = model.deleteTask(next, id, ids);}
    else {throw new Error('Unsupported bulk mutation.');}
    const updated = model.findTask(next, id);
    results.push({requestedId: id, localId: updated?.id || task.id, deleted: mutation.kind === 'delete'});
  }
  if (requestId) {(next.mutationRequests ||= {})[requestId] = {signature, results};}
  return {next, results};
}
module.exports = {mutate};
