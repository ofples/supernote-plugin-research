# Offline workflow implementation

Development branch: `feature/offline-task-workflow`. Author: Ofer Plesser. Fork of apclark31/supernote-plugin-research; upstream licenses and attribution remain in place.

This is work in progress, not a tested device release. The workspace execution brief is `../../../plugin-development/TASK_WORKFLOW_GOAL.md` and the design plan beside it.

## Storage decision

The official SDK's `getPluginDirPath()` exposes the calling plugin's own private directory. Official permissions documentation explicitly excludes arbitrary other paths; it does not document a supported cross-plugin private-file reader. We therefore use the SDK private directory for the authoritative store and queue, with no shared-storage fallback. A custom native module provides checksummed generations, file and directory synchronization and atomic rename. Its ReactPackage is the existing `com.supertask.NoteOpenerPackage`.

The planned Dashboard exchange is an **explicitly enabled** token-free snapshot in MyStyle. Enabling it must explain that task titles, dates, project/label data and source-note links can be synced by Supernote cloud. The snapshot must never include command payloads, API tokens, token fingerprints, task descriptions or the authoritative queue. Disabling must revoke/remove the published snapshot where allowed and report deletion failure, rather than quietly leaving a readable export behind. Export failures cannot undo a saved task.

Each task store is device-bound and partitioned by a SHA-256 fingerprint of the configured token, which is never exported. The worker also verifies Todoist's user ID before uploading. Token rotation deliberately retains the previous store and does not automatically replay its outbox under a new credential. A later account recovery/import flow needs an explicit reviewed design; it is not safe to merge queues just because the user switched tokens.

Sources checked 3 October 2026:

- [Supernote private-directory access](https://docs.supernote.com/en/plugin-base/permission)
- [getPluginDirPath](https://docs.supernote.com/en/api-reference/supernote-plugin/plugin-manager/get-plugin-dir-path)
- [Lifecycle listener](https://docs.supernote.com/en/api-reference/supernote-plugin/plugin-manager/register-plugin-life-listener)
- [Todoist API v1 Sync commands](https://developer.todoist.com/api/v1/): stable command UUID idempotency, `sync_status` per-command acknowledgement, and `temp_id_mapping`.

SDK installed from the existing lockfile: `sn-plugin-lib` 0.1.65. Its types confirm the directory and lifecycle signatures. Native context/path behavior still requires testing inside the actual PluginHost.

## Local verification

Run `node --test tests/*.test.cjs` from this plugin directory. The host-independent model, serialized store and worker have coverage for ten-task batch atomicity, invalid items, capture-time dates, failed writes, concurrent saves, corruption, account/device mismatch, frozen uncertain retries, safe unsent edits/cancellation, partial acknowledgements, missing mappings, create/complete/reopen dependencies, 429/auth failures, overlays, privacy allowlists, lost responses and worker deduplication.

Current results: 21 tests pass, targeted lint has no warnings, and `:app:compileDebugKotlin` succeeds for the custom storage module. The first compile exposed an unavailable Android constant; directory synchronization now uses supported `Os.open`/`Os.fsync`. These checks cover the foundation only. The runtime service is not yet connected to existing screens, and no complete package has been produced for the new workflow.

The fake service simulates server acceptance followed by a lost response, and proves identical replay creates ten remote tasks once. Actual Todoist replay/mapping retention is still pending; a fake service cannot prove server behavior.

## Live target recorded

On 3 October 2026 ADB sees Nomad `SN078D10010594`, firmware `Chauvet.E103.2609111001.2505_beta`, PluginHost `1.00.26009090` (code `1002609090`). A shell cannot read the app-private plugin directory, as expected; that is not proof the native module can access it. No replacement plugin has been installed for this workflow yet.

Dependency install baseline (`npm ci --ignore-scripts`): SuperTask reports 69 advisories (1 low, 7 moderate, 58 high, 3 critical), Dashboard reports 64 (6 moderate, 56 high, 2 critical). These are inherited dependency findings requiring compatible review; do not use forced upgrades that change the host runtime. Packaging and device validation remain pending.
