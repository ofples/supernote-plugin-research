# SuperTask offline and batch workflow

Version `0.4.0-beta.4`, branch `feature/offline-task-workflow`, author Ofer Plesser. Fork of apclark31/supernote-plugin-research; licenses and attribution remain. SuperDashboard is deferred. InkToClipboard and the recognition-enhancer experiment are unchanged.

## Setup and use

1. Open SuperTask from the note toolbar or Plugin Manager's Settings. Settings also has a **Tasks** button.
2. Settings → Setup: configure your Todoist API token and allow Internet access. Existing shared settings migrate automatically if their file permission is granted. Fetch tasks once online to populate the private task/project cache.
3. With Wi-Fi off, cached lists remain available. **+ New** saves one task; **+ Batch** opens manual multi-task review. **Pending** includes undated queued tasks.
4. Lasso handwritten lines in a note → **Add Task**. Native OCR supplies editable rows. Merge wrapped lines, insert line breaks and split, remove/exclude rows, and set each row's project, priority, date, description and labels. Save selected rows as one durable batch; Cancel before saving creates nothing. The flow leaves handwriting elements unchanged.
5. Reopen/resume SuperTask after reconnecting, or tap Refresh. A foreground-only 30-second poll also notices reconnection. Sync stops on close; there is no promise of execution while all plugins are closed.

Use finger touch and the keyboard in review. Upstream documents a host EMR issue where pen input can reach the underlying note while a plugin is shown. Capture itself is read-only; physical pen isolation is not an SDK guarantee.

**Todoist sections are not displayed or selectable.** Projects contain all their tasks grouped by due-date buckets. Named sections, section-aware creation and subtask hierarchy views are future work.

## Optional AI refinement

Open **AI settings** from review or Settings → Setup. Save a separate OpenAI key and model (default `gpt-4.1-mini`). Keys stay in plugin-private storage. Clearing the key disables refinement; the InkToClipboard key is not copied or read.

**Refine with AI** explicitly sends selected rows, project names/IDs and capture date to OpenAI. If every row is selected and a preview exists, it also sends the lasso crop. Excluding any row switches refinement to text only so excluded writing cannot reappear from the image. The preview is prepared privately and its temporary file is deleted after reading. AI creates no task automatically.

Vercel AI SDK uses the working InkToClipboard OpenAI Responses path and React Native buffered-fetch adapter. Strict structured output is validated locally for project IDs, dates, priorities, bounds and shape. `store:false` is requested. Valid suggestions remain editable; **Undo refinement** restores the preceding review. Failure, Stop or the 90-second timeout retains original edits. This optional action needs a connection and may incur API charges.

Actual paid AI recognition and handwriting line fidelity remain pending; see [VALIDATION.md](VALIDATION.md). Deterministic tests exercise the real installed AI SDK, including its HTTP 200/buffered-body contract.

## Storage and migration

Tasks, queue, ID mappings, settings, credentials and logs live in `offline-v1` below the SDK private plugin directory. The native module checks Android ownership and refuses a shared fallback. The Nomad supplied `/data/user/0/com.ratta.supernote.pluginhost/files/plugins/supertask001`. No task-content snapshot is exported to MyStyle.

Stores are device-bound and partitioned by a private token fingerprint. The worker verifies Todoist's user ID before uploading. Serialized writes use checksummed main/previous generations, file/directory synchronization, atomic rename, an OS writer lock and stale-writer rejection. Failed saves are errors; damaged data is preserved rather than replaced with an empty queue. An uncertain native result is re-read and retries retain the same batch identities.

Migration commits settings privately before redacting the token/debug-server URL from `/MyStyle/SuperTask/supertask-config.json`. Setup shows any permission/redaction warning. Earlier cloud copies cannot be revoked. Legacy shared cache is not imported; tasks are fetched again. Legacy note references migrate only after the account is verified and their remote tasks are present. Old shared cache/registry/log files remain for deliberate cleanup.

Changing the token retains previous queues in another partition and displays a notice. It never replays them under the new credential. Returning to the exact old token resumes that partition. Automatic token-rotation/account queue transfer is not implemented. Do not uninstall or clear PluginHost state while work is queued; those actions can remove app-private data.

## Behavior and recovery

- Ordinary task creation, completion and reopening work offline. Local pending changes override fetched state.
- Edit/remove new tasks before their first send. Any possibly sent command keeps its UUID and payload frozen. **Retry sync** reuses both.
- Each command requires `sync_status`; creation also requires `temp_id_mapping`. HTTP 200 alone is insufficient. Missing acknowledgements/mappings remain queued; dependencies preserve create/complete/reopen order.
- Auth/permanent errors are visible. Rejected tasks show **Needs attention**; deleted-project rejection preserves the task. Restore project/access and retry. Editing/discarding attempted commands needs a separately reviewed recovery flow and is unavailable.
- Recurring-task completion, editing/deleting already remote tasks and remote completed-history refresh need a connection. Cached history and local completion remain available offline.
- Offline dates are calendar dates. Today/tomorrow resolve at capture/save time; delayed upload cannot shift them. Arbitrary natural-language due strings are rejected.
- Private source references contain full note path, zero-based page and optional selection bounds. Transient element UUIDs are not persisted. Actual scratch-note navigation remains pending.

If storage is unavailable, install the complete package and restart PluginHost without clearing data. If it is damaged, preserve both generations for reviewed recovery. For sync failures check permission, connection and Todoist token, then Pending. For AI failures check its separate key/model/quota; rows remain saveable without AI.

## Development

Use npm and the committed lockfile. Host pins: React Native `0.79.2`, React/renderer/types `19.0.0`, SDK `0.1.65`. AI dependencies are pinned exactly. Reuse Android SDK 35, NDK `27.1.12297006` and JDK 21.

From this directory run `npm ci`, `npm run test:offline`, and `npx tsc --noEmit`. Set JAVA_HOME to your JDK 21, run `./buildPlugin.ps1`, then `python verify_package.py`.

The build refuses missing native output and preserves custom ReactPackage registration. The verifier checks actual outer/nested identity, icon, JS markers, registration, classes and ARM64 libraries. Native/dependency changes require a full package install; a JS-only debug broadcast was ineffective on this beta host.

Official sources checked against installed SDK types on 3 October 2026: [Supernote private-path permissions](https://docs.supernote.com/en/plugin-base/permission), [getPluginDirPath](https://docs.supernote.com/en/api-reference/supernote-plugin/plugin-manager/get-plugin-dir-path), [lifecycle states](https://docs.supernote.com/en/api-reference/supernote-plugin/plugin-manager/register-plugin-life-listener#lifecycle-states), [Todoist Sync API v1](https://developer.todoist.com/api/v1/), [OpenAI structured outputs](https://platform.openai.com/docs/guides/structured-outputs), [AI SDK structured data](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data).

See [VALIDATION.md](VALIDATION.md) for artifact hash, device evidence and remaining checks.
