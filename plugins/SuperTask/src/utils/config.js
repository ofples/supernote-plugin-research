/** Settings and credentials are private. Shared legacy settings are read only for migration. */
import RNFS from 'react-native-fs';
import {PluginManager} from 'sn-plugin-lib';
import {privateStorage} from '../offline/privateStorage';
import {log, setDebugServerUrl} from './debug';
import {setFontScale, normalizeFontScale} from './fontScale';

function withDerived(merged) {
  merged.fontScale = normalizeFontScale(merged.fontScale);
  setFontScale(merged.fontScale);
  setDebugServerUrl(merged.debugServerUrl);
  return merged;
}

const DEFAULT_CONFIG = {
  apiToken: '',
  aiApiKey: '',
  aiModel: 'gpt-4.1-mini',
  privacyWarning: '',
  debugServerUrl: '',
  defaultProjectId: null,
  defaultSectionId: null,
  defaultPriority: 1,
  enabledProjectIds: [],
  // 'last' resolves to lastOpenedTab (F-038). Existing installs keep their
  // saved explicit tab; only fresh configs get the remember-where-I-was default.
  defaultTab: 'last',
  // Hidden (no UI row): the TaskHome tab the user was last on, persisted on
  // every tab switch so 'last' survives process restarts.
  lastOpenedTab: 'today',
  postCreateAction: 'prompt',
  debugMode: false,
  markAsTextFontSize: 32,
  // 'off', 'finger', or 'pen-lasso'. Controls the quick-add lasso gesture only;
  // long press and three-finger double tap are always active. Default 'off':
  // hold-then-drag resembles a paused scroll, so it is opt-in (session 34).
  lassoGestureInput: 'off',
  // Strict edge swipe: exactly three coherent finger contacts from the bottom
  // edge. Opt-in; unknown physical dimensions or ambiguous streams fail closed.
  bezelSwipeEnabled: false,
  launcherEnabled: false,
  launcherEdge: 'right',
  launcherPosition: 0.45,
  // Three-finger double tap opens task home ANYWHERE on the canvas -- no
  // geometric constraint, so palm activity can mimic it (B-028). Opt-in
  // since session 34; was always-on from session 31 until B-028.
  threeFingerTapEnabled: false,
  // Show completed tasks inline on the Today tab (footer toggle, F-030)
  showDoneTasks: false,
  // Accessibility text scale: 1 / 1.15 / 1.3 (F-031)
  fontScale: 1,
  // B-033: one-shot native view invalidate after TaskHome's first content
  // paint, to clear the note ghost left by the partial refresh on open.
  // Device-confirmed 2026-09-06 (no visible cost), so there is no UI row --
  // this is a hidden kill switch, editable in supertask-config.json over USB.
  refreshOnOpen: true,
};

const LEGACY_FILE = '/storage/emulated/0/MyStyle/SuperTask/supertask-config.json';
const LEGACY_KEY = 'sntask_v1_8f3a2c9d7e1b';
let _runtimeConfig = null;
let _configSource = 'defaults';
let _loadPromise = null;
let _saveChain = Promise.resolve();

function decodeLegacy(value) {
  if (typeof value !== 'string' || !value.startsWith('xor1:')) return value;
  const bytes = global.atob(value.slice(5));
  return Array.from(bytes).map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ LEGACY_KEY.charCodeAt(i % LEGACY_KEY.length))).join('');
}

async function readLegacy() {
  if (await PluginManager.hasPermission('plugin.permission.FILE:READ') !== 1) return null;
  if (!(await RNFS.exists(LEGACY_FILE))) return null;
  const value = JSON.parse(await RNFS.readFile(LEGACY_FILE, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Legacy settings are damaged. Import your token in Settings.');
  value.apiToken = decodeLegacy(value.apiToken) || '';
  value.debugServerUrl = decodeLegacy(value.debugServerUrl) || '';
  if (value.apiToken === 'YOUR_TOKEN_HERE') value.apiToken = '';
  return value;
}

export async function loadConfig() {
  if (_runtimeConfig) return withDerived({...DEFAULT_CONFIG, ..._runtimeConfig});
  if (_loadPromise) return _loadPromise;
  _loadPromise = (async () => {
    const {storage} = await privateStorage();
    const raw = await storage.readSettings();
    if (raw !== null && raw !== undefined) {
      const value = JSON.parse(raw);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Private settings are damaged.');
      _runtimeConfig = value;
      _configSource = 'private';
    } else {
      const legacy = await readLegacy();
      const value = {...DEFAULT_CONFIG, ...(legacy || {})};
      if (legacy) {
        value.privacyWarning = 'Legacy settings were migrated. A prior shared copy may have been cloud-synced; rotate your token if needed.';
        // Commit privately FIRST. A failed save leaves legacy settings intact.
        await storage.saveSettings(JSON.stringify(value));
        if (await PluginManager.hasPermission('plugin.permission.FILE:WRITE') === 1) {
          try {
            const redacted = {...legacy, apiToken: '', debugServerUrl: ''};
            await RNFS.writeFile(LEGACY_FILE + '.tmp', JSON.stringify(redacted), 'utf8');
            await RNFS.moveFile(LEGACY_FILE + '.tmp', LEGACY_FILE);
          } catch {
            value.privacyWarning += ' The shared settings copy could not be redacted; remove its token manually.';
            await storage.saveSettings(JSON.stringify(value));
          }
        } else {
          value.privacyWarning += ' Allow shared-folder access and remove the old token from MyStyle/SuperTask/supertask-config.json.';
          await storage.saveSettings(JSON.stringify(value));
        }
      }
      _runtimeConfig = value;
      _configSource = legacy ? 'private' : 'defaults';
    }
    return withDerived({...DEFAULT_CONFIG, ..._runtimeConfig});
  })().finally(() => { _loadPromise = null; });
  return _loadPromise;
}

export function resolveDefaultTab(config) {
  const tab = config?.defaultTab || 'last';
  return tab === 'last' ? config?.lastOpenedTab || 'today' : tab;
}
export function getCachedConfig() {
  return _runtimeConfig ? {...DEFAULT_CONFIG, ..._runtimeConfig} : null;
}
export function wasTemplateGenerated() { return false; }
export function getConfigSource() { return _configSource; }
export async function reloadConfig() {
  await _saveChain;
  _runtimeConfig = null;
  return loadConfig();
}
export function saveConfig(changes) {
  const run = _saveChain.then(async () => {
    try {
      const current = await loadConfig();
      const merged = {...current, ...changes};
      const {storage} = await privateStorage();
      await storage.saveSettings(JSON.stringify(merged));
      _runtimeConfig = withDerived(merged);
      _configSource = 'private';
      if (Object.prototype.hasOwnProperty.call(changes, 'apiToken')) {
        require('../cache/taskCache').invalidateCache();
      }
      return true;
    } catch (error) {
      log('Config', `Private settings save failed: ${error.message}`);
      return false;
    }
  });
  _saveChain = run.catch(() => {});
  return run;
}
