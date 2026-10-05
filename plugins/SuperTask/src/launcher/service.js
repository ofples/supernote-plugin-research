import {DeviceEventEmitter, NativeModules} from 'react-native';
import {
  loadConfig,
  saveConfig,
  resolveDefaultTab,
  getCachedConfig,
} from '../utils/config';
import {log} from '../utils/debug';

const bridge = NativeModules.TaskLauncher;
let initialized = false;
let viewOpen = false;
let revision = 0;
let queue = Promise.resolve();
const subscriptions = [];

export const launcherAvailable = !!bridge;
export async function launcherStatus() {
  if (!bridge) {
    return {
      permission: false,
      visible: false,
      scopedPenProtection: false,
      available: false,
    };
  }
  return {...(await bridge.getStatus()), available: true};
}
export async function requestLauncherPermission() {
  if (!bridge) {
    throw new Error('Reinstall the full plugin package to use the launcher.');
  }
  return bridge.requestPermission();
}
export function reloadLauncher() {
  const token = ++revision;
  const run = queue.then(async () => {
    const config = await loadConfig();
    if (!bridge || token !== revision) {
      return;
    }
    await bridge.configure(
      config.launcherEnabled === true,
      config.launcherEdge,
      config.launcherPosition,
    );
    bridge.setViewOpen(viewOpen);
  });
  queue = run.catch(error =>
    log('Launcher', `Configuration failed: ${error.message}`),
  );
  return run;
}
export function launcherViewChanged(open) {
  viewOpen = open;
  bridge?.setViewOpen(open);
}
export function launcherLifecycle(state) {
  if (state === 1) {
    reloadLauncher();
  }
  if (state === 2) {
    launcherViewChanged(true);
  }
  if (state === 3) {
    launcherViewChanged(false);
  }
  if (state >= 4) {
    revision++;
    bridge?.stop();
  }
}
export function initLauncher() {
  if (initialized || !bridge) {
    return;
  }
  initialized = true;
  subscriptions.push(
    DeviceEventEmitter.addListener('SuperTaskLauncherTap', async () => {
      // Native opens the view once, waking React; do not open it again here.
      require('../utils/viewState').markViewOpen('edge-launcher');
      const config = getCachedConfig() || (await loadConfig());
      const focusTab = resolveDefaultTab(config);
      global.__superTaskButtonId = null;
      global.__superTaskDeepLink = {action: 'this-page', focusTab};
      if (global.__superTaskNavigate) {
        global.__superTaskDeepLink = null;
        global.__superTaskNavigate('task-home', {focusTab});
      }
    }),
  );
  subscriptions.push(
    DeviceEventEmitter.addListener(
      'SuperTaskLauncherPosition',
      async position => {
        const ok = await saveConfig({
          launcherEdge: position.edge,
          launcherPosition: position.position,
        });
        if (!ok) {
          log(
            'Launcher',
            'Position could not be saved; restoring the last durable position',
          );
          reloadLauncher();
        }
      },
    ),
  );
  subscriptions.push(
    DeviceEventEmitter.addListener('SuperTaskLauncherError', event => {
      log('Launcher', event.message || 'Launcher unavailable');
      if (event.launchFailed) {
        require('../utils/viewState').markViewClosed('launcher-error');
      }
    }),
  );
  subscriptions.push(
    DeviceEventEmitter.addListener('SuperTaskLauncherResume', reloadLauncher),
  );
  reloadLauncher();
}
