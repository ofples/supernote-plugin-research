const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function fixture({pending = false, failSave = false} = {}) {
  const filename = path.resolve(__dirname, '../src/launcher/service.js');
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const listeners = new Map(),
    calls = [],
    navigation = [],
    marks = [];
  let config = {
    launcherEnabled: true,
    launcherEdge: 'right',
    launcherPosition: 0.45,
    defaultTab: 'today',
  };
  const native = {
    getStatus: async () => ({hidePending: pending}),
    configure: async (...args) => {
      calls.push(['configure', ...args]);
    },
    confirmHide: async () => {
      calls.push(['confirmHide']);
      pending = false;
    },
    setViewOpen: value => calls.push(['viewOpen', value]),
    stop: () => calls.push(['stop']),
  };
  const configAPI = {
    loadConfig: async () => ({...config}),
    getCachedConfig: () => ({...config}),
    resolveDefaultTab: value => value.defaultTab,
    saveConfig: async patch => {
      calls.push(['save', patch]);
      if (failSave) return false;
      config = {...config, ...patch};
      return true;
    },
  };
  const mocks = {
    'react-native': {
      NativeModules: {TaskLauncher: native},
      DeviceEventEmitter: {
        addListener(name, callback) {
          assert.equal(listeners.has(name), false);
          listeners.set(name, callback);
          return {
            remove() {
              listeners.delete(name);
            },
          };
        },
      },
    },
    '../utils/config': configAPI,
    '../utils/debug': {log: (...args) => calls.push(['log', ...args])},
    '../utils/viewState': {
      markViewOpen: source => marks.push(['open', source]),
      markViewClosed: source => marks.push(['closed', source]),
    },
  };
  const normal = loaded.require.bind(loaded);
  loaded.require = name =>
    Object.hasOwn(mocks, name) ? mocks[name] : normal(name);
  loaded._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    filename,
  );
  global.__superTaskDeepLink = {action: 'lasso-add'};
  global.__superTaskButtonId = 200;
  global.__superTaskNavigate = (...args) => navigation.push(args);
  return {
    service: loaded.exports,
    listeners,
    calls,
    navigation,
    marks,
    configAPI,
    config: () => config,
    pending: () => pending,
    hideNative: () => {
      pending = true;
    },
  };
}

test('accepted Settings event routes the mounted app without calling showPluginView again', async () => {
  const f = fixture();
  f.service.initLauncher();
  await f.service.reloadLauncher();
  await f.listeners.get('SuperTaskLauncherTap')({route: 'settings'});
  assert.deepEqual(f.navigation, [['config']]);
  assert.equal(global.__superTaskDeepLink, null);
  assert.equal(global.__superTaskButtonId, null);
  assert.deepEqual(f.marks, [['open', 'edge-launcher']]);
  f.service.initLauncher(); // No duplicate listener registration.
});
test('Settings before App mount replaces a stale lasso route with the existing config entry', async () => {
  const f = fixture();
  f.service.initLauncher();
  await f.service.reloadLauncher();
  global.__superTaskNavigate = null;
  await f.listeners.get('SuperTaskLauncherTap')({route: 'settings'});
  assert.equal(global.__superTaskButtonId, 'config');
  assert.equal(global.__superTaskDeepLink, null);
});
test('ordinary accepted tap still routes the configured task tab', async () => {
  const f = fixture();
  f.service.initLauncher();
  await f.service.reloadLauncher();
  await f.listeners.get('SuperTaskLauncherTap')({route: 'tasks'});
  assert.deepEqual(f.navigation, [['task-home', {focusTab: 'today'}]]);
});
test('native quick Hide commits disabled privately before acknowledging the pending marker', async () => {
  const f = fixture();
  f.service.initLauncher();
  await f.service.reloadLauncher();
  f.calls.length = 0;
  f.hideNative();
  await f.listeners.get('SuperTaskLauncherHide')();
  assert.equal(f.config().launcherEnabled, false);
  assert.equal(f.pending(), false);
  assert.ok(
    f.calls.findIndex(c => c[0] === 'save') <
      f.calls.findIndex(c => c[0] === 'confirmHide'),
  );
  assert.equal(f.calls.find(c => c[0] === 'configure')[1], false);
});
test('paused/restarted React replays the native Hide marker on resume without a lost event', async () => {
  const f = fixture({pending: true});
  f.service.initLauncher();
  await f.listeners.get('SuperTaskLauncherResume')();
  assert.equal(f.config().launcherEnabled, false);
  assert.equal(f.pending(), false);
  assert.equal(
    f.calls.some(c => c[0] === 'configure' && c[1] === true),
    false,
  );
});
test('failed private save keeps native Hide pending; never acknowledges or reenables', async () => {
  const f = fixture({pending: true, failSave: true});
  f.service.initLauncher();
  await f.listeners.get('SuperTaskLauncherResume')();
  assert.equal(f.pending(), true);
  assert.equal(
    f.calls.some(c => c[0] === 'confirmHide' || c[0] === 'configure'),
    false,
  );
  await assert.rejects(
    f.service.reloadLauncher(),
    /hidden now.*waiting to save locally/,
  );
});
test('an explicit durable Settings preference can clear pending Hide and reenable', async () => {
  const f = fixture({pending: true});
  await f.configAPI.saveConfig({launcherEnabled: true});
  await f.service.confirmLauncherPreference();
  await f.service.reloadLauncher();
  assert.equal(f.pending(), false);
  assert.equal(f.calls.find(c => c[0] === 'configure')[1], true);
});
test('native launch rejection does not route or close a newer toolbar-opened view', async () => {
  const f = fixture();
  f.service.initLauncher();
  await f.service.reloadLauncher();
  f.service.launcherViewChanged(true);
  f.listeners.get('SuperTaskLauncherError')({
    message: 'Rejected',
    launchFailed: true,
  });
  assert.deepEqual(f.navigation, []);
  assert.deepEqual(f.marks, []);
  assert.deepEqual(f.calls.filter(c => c[0] === 'viewOpen').at(-1), [
    'viewOpen',
    true,
  ]);
});
