const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function loadConfigModule(initial) {
  let saved = JSON.stringify(initial);
  let releaseWrite;
  let holdFirstWrite = true;
  const writes = [];
  const storage = {
    readSettings: async () => saved,
    saveSettings: async value => {
      if (holdFirstWrite) {
        holdFirstWrite = false;
        await new Promise(resolve => {releaseWrite = resolve;});
      }
      saved = value;
      writes.push(JSON.parse(value));
    },
  };
  const overrides = {
    'react-native-fs': {}, 'sn-plugin-lib': {PluginManager: {hasPermission: async () => 0}},
    '../offline/privateStorage': {privateStorage: async () => ({storage})},
    './debug': {log() {}, setDebugServerUrl() {}},
    './fontScale': {setFontScale() {}, normalizeFontScale: value => value || 1},
    '../cache/taskCache': {invalidateCache() {}},
  };
  const filename = path.resolve(__dirname, '../src/utils/config.js');
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const normal = mod.require.bind(mod);
  mod.require = request => Object.hasOwn(overrides, request) ? overrides[request] : normal(request);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  }}).outputText, filename);
  return {api: mod.exports, writes, release: () => releaseWrite(), saved: () => JSON.parse(saved)};
}

test('serialized save updaters merge scoped preferences against the latest private config', async () => {
  const store = loadConfigModule({apiToken: 'secret', workspacePreferences: {accounts: {'private-A': {today: {view: 'list'}}}}});
  await store.api.loadConfig();
  const writeA = store.api.saveConfig(current => ({workspacePreferences: {
    ...current.workspacePreferences,
    accounts: {...current.workspacePreferences.accounts, 'private-A': {...current.workspacePreferences.accounts['private-A'], today: {view: 'board'}}},
  }}));
  const writeB = store.api.saveConfig(current => ({workspacePreferences: {
    ...current.workspacePreferences,
    accounts: {...current.workspacePreferences.accounts, 'private-B': {upcoming: {sortBy: 'due'}}},
  }}));
  await new Promise(resolve => setImmediate(resolve));
  store.release();
  assert.equal(await writeA, true);
  assert.equal(await writeB, true);
  assert.equal(store.saved().apiToken, 'secret');
  assert.equal(store.saved().workspacePreferences.accounts['private-A'].today.view, 'board');
  assert.equal(store.saved().workspacePreferences.accounts['private-B'].upcoming.sortBy, 'due');
  assert.equal(store.writes.length, 2);
});

test('a scoped save updater can safely skip after its account guard expires', async () => {
  const store = loadConfigModule({apiToken: 'account-a', workspacePreferences: {accounts: {'private-A': {today: {view: 'list'}}}}});
  await store.api.loadConfig();
  let activeAccount = 'private-A';
  const update = store.api.saveConfig(current => activeAccount === 'private-A' ? ({workspacePreferences: {
    ...current.workspacePreferences,
    accounts: {...current.workspacePreferences.accounts, 'private-A': {today: {view: 'board'}}},
  }}) : null);
  activeAccount = 'private-B';
  assert.equal(await update, true);
  assert.equal(store.writes.length, 0);
  assert.equal(store.saved().workspacePreferences.accounts['private-A'].today.view, 'list');
});
