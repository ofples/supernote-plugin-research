const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
function deferred() {
  let resolve;
  const promise = new Promise(done => {resolve = done;});
  return {promise, resolve};
}
function load(service) {
  const filename = path.resolve(__dirname, '../src/cache/taskCache.js');
  const mod = new Module(filename, module);
  mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const normal = mod.require.bind(mod);
  mod.require = name => name === '../offline/service' ? service : name === '../utils/debug' ? {log() {}} : normal(name);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, allowJs: true},
  }).outputText, filename);
  return mod.exports;
}
test('old account hydration cannot overwrite the newly selected account cache', async () => {
  const old = deferred(); let reads = 0;
  const current = {tasks: [{content: 'New account'}]};
  const cache = load({subscribeOffline() {}, offlineData: () => ++reads === 1 ? old.promise : Promise.resolve(current)});
  const stale = cache.initTaskCache();
  cache.invalidateCache();
  await Promise.resolve();
  old.resolve({tasks: [{content: 'Old account'}]});
  await stale;
  assert.deepEqual(cache.getCache(), current);
});
test('an old account sync result is rejected without clearing a new in-flight sync', async () => {
  const old = deferred(); const current = deferred(); let calls = 0;
  const cache = load({subscribeOffline() {}, offlineData: async () => ({tasks: []}),
    syncOffline: () => ++calls === 1 ? old.promise : current.promise});
  const first = cache.fetchTaskData();
  const rejected = assert.rejects(first, /account changed/);
  cache.invalidateCache();
  const second = cache.fetchTaskData();
  old.resolve({tasks: [{content: 'Old account'}]});
  await rejected;
  assert.equal(cache.fetchTaskData(), second);
  current.resolve({tasks: [{content: 'Current account'}]});
  await second;
  assert.equal(cache.getCache().tasks[0].content, 'Current account');
});
