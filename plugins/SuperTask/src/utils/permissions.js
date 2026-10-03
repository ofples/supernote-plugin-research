/**
 * Plugin permissions (Chauvet 3.29.44 / 2.26.41 "plugin permission
 * management", sn-plugin-lib 0.1.65; SNDEV-70, SNDEV-71).
 *
 * DECLARATION IS MANDATORY: every permission requested here must also be
 * listed in PluginConfig.json `uses-permissions` (root-level string array),
 * or requestPermission rejects with error 1500 and NO dialog appears -- the
 * exact symptom of the 2026-09-06 first device pass. Source:
 * docs.supernote.com/en/plugin-base/permission. Other facts from that page:
 *   - requestPermission returns 0 don't allow, 1 allow this time only,
 *     2 always allow, -1 dialog closed (treat as denied).
 *   - "Allow this time only" expires when the plugin exits; hasPermission
 *     then reads 0 again and the explainer / just-in-time ask repeats.
 *   - After a "don't allow", re-prompting shows a settings-redirect dialog
 *     (there IS a system settings page for plugin permissions).
 *   - The plugin's private dir (getPluginDirPath) needs no permission; only
 *     the six shared folders (incl. MyStyle) do. SDK file APIs return 1501 /
 *     1503 without WRITE / READ; raw RNFS calls simply fail.
 *
 * The firmware grants permissions per plugin, one host dialog per permission
 * (Deny / Allow while in use / Always allow). The SDK has no batch call and
 * PluginConfig.json has no declaration, so the dialogs cannot be merged.
 * What the plugin controls is WHEN each one fires and what the user has read
 * beforehand. Design (Alex, 2026-09-06):
 *
 *   1. One explainer screen of ours on first launch (PermissionsIntro) with
 *      three plain-language rows, each expandable to the full reason.
 *   2. Just-in-time requests, grouped by the human concept, not the
 *      technical name:
 *        folder  = FILE:READ + FILE:WRITE  -> at Continue on the explainer
 *        sync    = INTERNET                -> first Todoist/log-server call
 *        cleanup = FILE:DELETE             -> first token import
 *      So launch is two quick dialogs the user was just told about; the
 *      others appear where the reason is self-evident.
 *   3. Technical names appear only inside the expanded "why" text.
 *
 * Scope discipline: every file SuperTask reads or writes lives in
 * MyStyle/SuperTask, except two read-only exists() pre-flights on note paths.
 * Persistence never deletes: atomic writes rename over the old file, the
 * cache is invalidated by overwriting, the log rotates by copy+truncate. The
 * only delete is the token file after import.
 *
 * States per SDK JSDoc: hasPermission 0 = not granted, 1 = granted;
 * requestPermission 0 = denied, 1 = allow while in use, 2 = always. FILE:READ
 * is named by Ratta's review guidelines but not in the SDK JSDoc; it is
 * passed through by name and an unknown name is logged, never fatal.
 */
import {PluginManager} from 'sn-plugin-lib';
import {log} from './debug';

const READ = 'plugin.permission.FILE:READ';
const WRITE = 'plugin.permission.FILE:WRITE';
const DELETE = 'plugin.permission.FILE:DELETE';
const INTERNET = 'plugin.permission.INTERNET';

// Short display names for logs and technical footnotes
const SHORT = {
  [READ]: 'FILE:READ',
  [WRITE]: 'FILE:WRITE',
  [DELETE]: 'FILE:DELETE',
  [INTERNET]: 'INTERNET',
};

/**
 * The three things SuperTask asks for, in the words the user sees.
 * `summary` is the one-liner under the row; `why` is the expanded text;
 * `desc` is what the host shows if it re-prompts after a denial.
 */
export const PERMISSION_GROUPS = [
  {
    id: 'folder',
    label: 'Import legacy settings and open source notes',
    summary: 'Optional shared-folder access. Private task storage needs no file permission.',
    why: 'SuperTask reads its old settings and task references from MyStyle/SuperTask during migration and can redact the old token after saving privately. Shared access also lets it import a token file and check source notes before opening them. New credentials, cached tasks, queues and troubleshooting logs stay in its private folder. Batch capture reads your lasso selection through Supernote without changing the note. (FILE:READ and FILE:WRITE.)',
    permissions: [READ, WRITE],
    desc: 'Allow shared access for legacy migration, token import and source-note navigation. Private settings and offline tasks do not require this.',
  },
  {
    id: 'sync',
    label: 'Network access',
    summary: 'Todoist sync, optional OpenAI refinement, and explicit log upload.',
    why: 'SuperTask connects to api.todoist.com with your Todoist token. Refine with AI explicitly sends reviewed rows and the selected image to api.openai.com with your separately configured API key. Upload Log sends troubleshooting data only to a server you configure. No AI call is automatic and nothing is sent to the plugin author. (INTERNET.)',
    permissions: [INTERNET],
    desc: 'Allow Todoist sync, optional OpenAI refinement and explicit troubleshooting uploads.',
  },
  {
    id: 'cleanup',
    label: 'Clean up after itself',
    summary: 'Deletes only its own files, such as the token file after import.',
    why: 'When you import your Todoist token from a file, SuperTask deletes that file right after reading it, so your token never sits on the device in plain text. That is the only thing it deletes. It never deletes notes, documents, or anything outside its own folder. (Supernote calls this FILE:DELETE.)',
    permissions: [DELETE],
    desc: 'SuperTask deletes the token file after importing it, so your token is not left in plain text. It never deletes notes or documents.',
  },
];

// Some APIs return bare numbers, others APIResponse-wrapped -- accept both.
function unwrap(raw) {
  return typeof raw === 'object' && raw !== null ? raw.result : raw;
}

export function isPermissionApiAvailable() {
  return typeof PluginManager.hasPermission === 'function';
}

async function hasPerm(key) {
  try {
    return unwrap(await PluginManager.hasPermission(key));
  } catch (e) {
    log('Perms', `${SHORT[key]} hasPermission failed: ${e.message}`);
    return null;
  }
}

/**
 * Read-only snapshot for Settings and the explainer. Never shows a dialog.
 * @returns {Promise<{supported: boolean, groups: Record<string, 'granted'|'missing'|'partial'|'unknown'>, states: Record<string, number|null>}>}
 */
export async function getPermissionStates() {
  if (!isPermissionApiAvailable()) return {supported: false, groups: {}, states: {}};
  const states = {};
  const groups = {};
  for (const g of PERMISSION_GROUPS) {
    let granted = 0;
    let unknown = 0;
    for (const key of g.permissions) {
      const st = await hasPerm(key);
      states[SHORT[key]] = st;
      if (st === 1) granted++;
      else if (st === null) unknown++;
    }
    groups[g.id] =
      granted === g.permissions.length ? 'granted'
      : granted > 0 ? 'partial'
      : unknown === g.permissions.length ? 'unknown'
      : 'missing';
  }
  return {supported: true, groups, states};
}

// A group that was denied is not re-asked on every call that needs it --
// once per process unless the caller forces (Settings > Allow missing,
// the explainer's Continue). Denied features fail visibly on their own.
const _askedThisProcess = new Set();

// Concurrent callers share one host dialog. TaskHome's mount fires several
// Todoist requests at once; without this the second caller saw
// "_askedThisProcess" already set, returned false, and painted "Todoist
// access not allowed" while the user was still tapping Always allow on the
// dialog the first caller had opened (device 2026-09-06).
const _inflight = new Map();

function requestOnce(key, desc, id) {
  if (_inflight.has(key)) return _inflight.get(key);
  const p = (async () => {
    try {
      const res = unwrap(await PluginManager.requestPermission(key, desc));
      log('Perms', `${SHORT[key]} requestPermission -> ${res} (0=denied,1=this-time-only,2=always,-1=closed) [group ${id}]`);
      return res === 1 || res === 2;
    } catch (e) {
      // 1500 = not declared in PluginConfig.json uses-permissions; 1502 =
      // name unsupported on this firmware. Either way: no dialog was shown.
      log('Perms', `${SHORT[key]} requestPermission FAILED (no dialog shown): ${e.message}`);
      return false;
    } finally {
      _inflight.delete(key);
    }
  })();
  _inflight.set(key, p);
  return p;
}

/**
 * Ask for every group in order, one dialog at a time -- the explainer's
 * Continue (Alex, 2026-09-06 device pass: since the user has just read what
 * all three are for, walking through them there beats a surprise prompt
 * mid-task-list; the just-in-time asks stay as the safety net for "this
 * time only" expiry and changed minds). Returns per-group results.
 * @returns {Promise<Record<string, boolean>>}
 */
export async function ensureAllPermissionGroups() {
  const results = {};
  for (const g of PERMISSION_GROUPS) {
    results[g.id] = await ensurePermissionGroup(g.id, {force: true});
  }
  log('Perms', `explainer pass: ${Object.entries(results).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  return results;
}

/**
 * Make sure a group is granted, asking the host for each missing
 * permission in order (one dialog at a time). Never throws.
 * @param {'folder'|'sync'|'cleanup'} id
 * @param {{force?: boolean}} [opts]
 * @returns {Promise<boolean>} true when every permission in the group is granted
 */
export async function ensurePermissionGroup(id, opts = {}) {
  if (!isPermissionApiAvailable()) return true; // pre-permission firmware
  const g = PERMISSION_GROUPS.find(x => x.id === id);
  if (!g) return true;
  let all = true;
  for (const key of g.permissions) {
    const has = await hasPerm(key);
    if (has === 1) continue;
    if (has === null) { all = false; continue; } // unknown name on this firmware
    if (_inflight.has(key)) {
      // Someone else already has the dialog up -- wait for that answer.
      if (!(await _inflight.get(key))) all = false;
      continue;
    }
    if (_askedThisProcess.has(key) && !opts.force) {
      all = false;
      continue;
    }
    _askedThisProcess.add(key);
    if (!(await requestOnce(key, g.desc, id))) all = false;
  }
  return all;
}

/**
 * Startup: log every permission's state so a denied one is visible in the
 * session log next to whatever fails because of it. No dialogs -- those
 * belong to the explainer and the just-in-time call sites.
 */
export async function logPermissionStates() {
  if (!isPermissionApiAvailable()) {
    log('Perms', 'permission API unavailable (SDK/firmware pre-0.1.65) -- nothing to check');
    return {supported: false, groups: {}, states: {}};
  }
  const snap = await getPermissionStates();
  const parts = Object.entries(snap.states).map(([k, v]) => `${k}=${v}`);
  log('Perms', `startup states: ${parts.join(' ')}`);
  const missing = Object.entries(snap.groups).filter(([, s]) => s !== 'granted').map(([g, s]) => `${g}:${s}`);
  log('Perms', missing.length ? `groups not fully granted: ${missing.join(', ')}` : 'all permission groups granted');
  return snap;
}
