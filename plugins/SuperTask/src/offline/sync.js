const {readyOperations, markSending, acknowledge, failOperations, replaceRemote, preflight, checkDestinations, reconcileAcknowledged} = require('./model');
const model = require('./model');
const locations = require('./locations');
const ordering = require('./order');
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
        if (ready.some(op => !op.attempts && (locations.locationKind(op) && !locations.isCreate(op) || op.kind === 'reorder'))) {
          const snapshot = await api.fetchSnapshot();
          state = await store.transaction(s => {
            const next = replaceRemote(s, snapshot.tasks, snapshot.projects, clock(), snapshot.sections);
            for (const candidate of ready) {
              const op = next.outbox.find(o => o.uuid === candidate.uuid);
              if (!op || op.attempts) {continue;}
              if (locations.locationKind(op) && !locations.isCreate(op)) {locations.preflight(next, op);}
              if (op.kind === 'reorder') {ordering.preflight(next, op, model);}
            }
            return next;
          });
          for (const candidate of ready.filter(op => !op.attempts && ['project_delete', 'collection_delete'].includes(op.kind))) {
            const op = state.outbox.find(o => o.uuid === candidate.uuid);
            if (!op || op.state === 'attention') {continue;}
            const kind = op.kind.startsWith('project_') ? 'project' : 'collection';
            const location = locations.find(state, kind, op.localId);
            if (kind === 'project') {
              const archives = api.fetchArchivedProjects ? await api.fetchArchivedProjects() : {complete: false, projects: []};
              state = await store.transaction(s => {
                s.archivedProjects = archives.projects;
                const queued = s.outbox.find(o => o.uuid === candidate.uuid);
                if (queued && !queued.attempts) {
                  if (!archives.complete) {locations.rejectDeleteProjection(s, queued, 'Archived descendant projects could not be verified. The project was not deleted.');}
                  else {locations.preflight(s, queued);}
                }
                return s;
              });
              if (state.outbox.find(o => o.uuid === candidate.uuid)?.state === 'attention') {continue;}
            }
            const history = op.expectedEmpty
              ? await api.verifyContainerHistory(kind, location.remoteId, kind === 'project' ? location.created_at : location.added_at, op.verificationBudget || 30)
              : api.fetchContainerHistorySince ? await api.fetchContainerHistorySince(kind, location.remoteId, op.capturedAt) : {complete: false, tasks: []};
            if (!history.complete || history.tasks.length) {
              state = await store.transaction(s => {
                const queued = s.outbox.find(o => o.uuid === candidate.uuid);
                if (queued && !queued.attempts) {locations.rejectDeleteProjection(s, queued, 'Completed contents changed or could not be verified. The container was not deleted.');}
                return s;
              });
            }
          }
          if (ready.some(op => !op.attempts && ['project_delete', 'collection_delete'].includes(op.kind))) {
            const finalSnapshot = await api.fetchSnapshot();
            state = await store.transaction(s => {
              const next = replaceRemote(s, finalSnapshot.tasks, finalSnapshot.projects, clock(), finalSnapshot.sections);
              for (const candidate of ready) {
                const op = next.outbox.find(o => o.uuid === candidate.uuid);
                if (op && !op.attempts && op.state !== 'attention' && ['project_delete', 'collection_delete'].includes(op.kind)) {locations.preflight(next, op);}
              }
              return next;
            });
          }
        }
        // An attempted operation may already have changed Todoist. Replay it
        // before considering any remote conflict on its dependent mutations.
        for (const op of ready) {
          if (op.attempts || op.kind === 'create' || locations.locationKind(op) || op.kind === 'reorder') {continue;}
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
          if (locations.locationKind(op) || op.kind === 'delete' || after.outbox.some(o => o.uuid === op.uuid)) {continue;}
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
  async function verifyContainer(kind, id, options = {}) {
    if (!['project', 'collection'].includes(kind)) {throw new Error('Unsupported container type.');}
    const existing = await store.load(), userId = String(await api.userId());
    if (!userId || userId === 'undefined' || userId === 'null' || existing.userId && existing.userId !== userId) {throw new Error('Todoist account changed. Scope verification was cancelled.');}
    const snapshot = await api.fetchSnapshot();
    let state = await store.transaction(s => replaceRemote(s, snapshot.tasks, snapshot.projects, clock(), snapshot.sections));
    if (kind === 'project' && api.fetchArchivedProjects) {
      const archives = await api.fetchArchivedProjects();
      state = await store.transaction(s => ({...s, archivedProjects: archives.projects}));
      if (!archives.complete) {return {...locations.scope(state, kind, id, model), canKeep: false, keepReason: 'Archived descendant verification reached its request limit.'};}
    }
    const plan = locations.scope(state, kind, id, model);
    if (!plan.allowed || plan.localOnly) {return plan;}
    if (plan.descendantProjectCount) {return {...plan, keepReason: 'Verify or move descendant projects separately before deleting their parent.'};}
    const location = locations.find(state, kind, id);
    const createdAt = kind === 'project' ? location.created_at : location.added_at;
    const maxPages = options.maxPages || 30;
    const history = await api.verifyContainerHistory(kind, location.remoteId || location.id, createdAt, maxPages);
    if (!history.complete) {return {...plan, canKeep: false, keepReason: history.reason};}
    const finalSnapshot = await api.fetchSnapshot();
    state = await store.transaction(s => {
      const next = replaceRemote(s, finalSnapshot.tasks, finalSnapshot.projects, clock(), finalSnapshot.sections);
      // A verification read must not erase unrelated cached history.
      const ids = new Set(history.tasks.map(t => t.id));
      next.completedRemote = [...(next.completedRemote || []).filter(t => !ids.has(t.id)), ...history.tasks.map(t => ({...t, completed: true, is_completed: true, occurrenceHistory: true}))];
      const verified = locations.scope(next, kind, id, model);
      // Exhausting an account-lifetime date range is advisory only: imported,
      // backdated or shared history can predate joined_at. Until Todoist exposes
      // a documented exact total that we can reconcile, never persist a claim
      // that this remote container's whole history is cached.
      (next.containerScopes ||= {})[`${kind}:${location.remoteId || location.id}`] = {complete: false, token: verified.scopeToken, verifiedAt: clock(), maxPages};
      return next;
    });
    return {...locations.scope(state, kind, id, model), complete: false, canKeep: false,
      keepReason: 'The dated history was fetched, but imported or backdated completions may be outside it. Todoist has no documented exact total proof here. Keep tasks is available only for never-sent local containers.'};
  }
  return {sync, verifyContainer};
}
module.exports = {createSyncWorker};

