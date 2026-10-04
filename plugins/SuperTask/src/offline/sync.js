const {readyOperations, markSending, acknowledge, failOperations, replaceRemote} = require('./model');

function createSyncWorker(store, api, clock = Date.now) {
  let running = null;
  function sync() {
    if (running) {return running;}
    const work = (async () => {
      let state = await store.load();
      // Verify the current credential's user before sending ANY queued change.
      const userId = String(await api.userId());
      if (!userId || userId === 'undefined' || userId === 'null') {throw new Error('Todoist did not identify the account.');}
      if (state.userId && state.userId !== userId) {throw new Error('Todoist account changed. This device queue was not sent.');}
      if (!state.userId) {state = await store.transaction(s => ({...s, userId}));}
      // A bounded pass allows create -> complete dependencies without timers or
      // an unbounded retry loop. Failed/backoff ops block their later commands.
      for (let round = 0; round < 20; round++) {
        state = await store.load();
        const ready = readyOperations(state, clock());
        if (!ready.length) {break;}
        state = await store.transaction(s => markSending(s, ready));
        const uuids = new Set(ready.map(op => op.uuid));
        const sending = state.outbox.filter(op => uuids.has(op.uuid));
        let response;
        try {
          response = await api.commands(sending.map(op => op.command));
        } catch (error) {
          await store.transaction(s => failOperations(s, sending, error, clock()));
          throw error;
        }
        // Persistence failures here leave 'sending' committed. Restart replays
        // its identical frozen UUID/payload instead of manufacturing new tasks.
        await store.transaction(s => acknowledge(s, sending, response, clock()));
      }
      const {tasks, projects, sections} = await api.fetchSnapshot();
      return store.transaction(s => replaceRemote(s, tasks, projects, clock(), sections));
    })();
    running = work.finally(() => { running = null; });
    return running;
  }
  return {sync};
}
module.exports = {createSyncWorker};
