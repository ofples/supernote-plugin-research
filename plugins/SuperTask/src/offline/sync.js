const {readyOperations, markSending, acknowledge, failOperations, replaceRemote, preflight, checkDestinations, reconcileAcknowledged} = require('./model');
function createSyncWorker(store, api, clock = Date.now) {
  let running = null;
  function sync() {
    if (running) {return running;}
    const work = (async () => {
      let state = await store.load();
      const userId = String(await api.userId());
      if (!userId || userId === 'undefined' || userId === 'null') {throw new Error('Todoist did not identify the account.');}
      if (state.userId && state.userId !== userId) {throw new Error('Todoist account changed. This device queue was not sent.');}
      if (!state.userId) {state = await store.transaction(s => ({...s, userId}));}
      if (state.outbox.some(op => !op.attempts && ['create', 'move', 'collection_create'].includes(op.kind))) {
        const {tasks, projects, sections} = await api.fetchSnapshot();
        state = await store.transaction(s => checkDestinations(replaceRemote(s, tasks, projects, clock(), sections)));
      }
      for (let round = 0; round < 100; round++) {
        state = await store.load();
        const ready = readyOperations(state, clock());
        if (!ready.length) {break;}
        // An attempted operation may already have changed Todoist. Replay it
        // before considering any remote conflict on its dependent mutations.
        for (const op of ready) {
          if (op.attempts || ['create', 'collection_create'].includes(op.kind)) {continue;}
          const task = state.tasks[op.localId];
          const remote = api.fetchTask ? await api.fetchTask(task.remoteId, task) : {status: 'unavailable'};
          await store.transaction(s => preflight(s, op.uuid, remote, clock()));
        }
        state = await store.load();
        const stillReady = readyOperations(state, clock()).filter(op => ready.some(r => r.uuid === op.uuid));
        if (!stillReady.length) {continue;}
        state = await store.transaction(s => markSending(s, stillReady));
        const uuids = new Set(stillReady.map(op => op.uuid));
        const sending = state.outbox.filter(op => uuids.has(op.uuid) && op.state === 'sending');
        if (!sending.length) {continue;}
        let response;
        try {response = await api.commands(sending.map(op => op.command));}
        catch (error) {await store.transaction(s => failOperations(s, sending, error, clock())); throw error;}
        const after = await store.transaction(s => acknowledge(s, sending, response, clock()));
        // Capture server-normalized fields/next recurrence before another local
        // mutation compares its baseline. A lost read is safe: acknowledgements
        // have already advanced the expected baseline for deterministic fields.
        if (api.fetchTask) {for (const op of sending) {
          if (op.kind === 'collection_create' || op.kind === 'delete' || after.outbox.some(o => o.uuid === op.uuid)) {continue;}
          const task = after.tasks[op.localId];
          try {
            const remote = await api.fetchTask(task.remoteId, task);
            await store.transaction(s => reconcileAcknowledged(s, op.localId, remote));
          } catch (error) {
            // Reading cannot un-acknowledge an accepted command. Stop before
            // a dependent operation, and let the next sync verify its baseline.
            await store.transaction(s => ({...s, syncError: error.message})); throw error;
          }
        }}
      }
      const {tasks, projects, sections} = await api.fetchSnapshot();
      return store.transaction(s => replaceRemote(s, tasks, projects, clock(), sections));
    })();
    running = work.finally(() => {running = null;}); return running;
  }
  return {sync};
}
module.exports = {createSyncWorker};

