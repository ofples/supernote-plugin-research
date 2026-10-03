const {clone, emptyStore, validateStore} = require('./model');

// Adapter is responsible for durable atomic replacement. Failed commits never
// become the in-memory truth, and a rejected operation cannot poison the chain.
function createStore(adapter, accountKey, deviceId, onChange = () => {}) {
  let state;
  let loading;
  let chain = Promise.resolve();
  let warning = null;
  async function load() {
    if (!loading) {loading = (async () => {
      const generations = await adapter.read();
      if (!generations.exists) {
        state = emptyStore(accountKey, deviceId);
        return;
      }
      for (const [index, raw] of [generations.main, generations.backup].entries()) {
        if (!raw) {continue;}
        try {
          state = validateStore(JSON.parse(raw), accountKey, deviceId);
          if (index) {warning = 'Recovered the previous saved generation. Check your most recent changes.';}
          return;
        } catch (error) {
          warning = error.message;
        }
      }
      throw new Error('Task storage is damaged or unsupported. Keep the files for recovery; no empty replacement was written.');
    })();}
    await loading;
    return clone(state);
  }
  function transaction(reduce) {
    const result = chain.then(async () => {
      await load();
      const previous = clone(state);
      const next = await reduce(clone(previous));
      next.revision = previous.revision + 1;
      validateStore(next, accountKey, deviceId);
      try {
        await adapter.commit(JSON.stringify(next), JSON.stringify(previous));
      } catch (error) {
        // The native write may have renamed successfully before returning an
        // error. Re-read authoritative disk state before allowing another save.
        try {
          const disk = await adapter.read();
          let recovered;
          for (const raw of [disk.main, disk.backup]) {
            if (!raw) continue;
            try { recovered = validateStore(JSON.parse(raw), accountKey, deviceId); break; }
            catch { /* try the previous generation before refusing more writes */ }
          }
          if (!recovered && disk.exists) throw new Error('Task storage could not be recovered after a failed save. Existing data was not overwritten.');
          state = recovered || previous;
          error.uncertainCommit = state.revision === next.revision;
        } catch (readError) {
          loading = Promise.reject(readError);
          loading.catch(() => {});
        }
        throw error;
      }
      state = clone(next);
      try { onChange(clone(state)); } catch { /* subscriber failure cannot undo a durable save */ }
      return clone(state);
    });
    chain = result.catch(() => {});
    return result;
  }
  return {load, transaction, getWarning: () => warning};
}
module.exports = {createStore};
