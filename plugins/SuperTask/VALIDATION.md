# Workflow validation — 3 October 2026

## Local results

| Check | Result |
|---|---|
| Offline/batch/transport/actual installed AI SDK contract tests | 32 passed |
| Full TypeScript check | Passed, including retained upstream screens |
| Changed runtime files ESLint | No errors; style warnings remain |
| Android/native and complete JS/package build | Passed |
| Actual outer/nested archive verifier | Passed |
| Dependency audit | Inherited 69 advisories: 1 low, 7 moderate, 58 high, 3 critical; compatible remediation remains pending |

Tests cover atomic batches, invalid drafts, capture-time dates, failed/uncertain writes, serialized captures, corruption, account/device binding, frozen retries, unsent correction/cancellation, partial/missing acknowledgement, dependencies, backoff/auth/permission errors and duplicate-safe simulated lost-response replay. Batch tests cover merge/split and strict proposals. Real AI SDK tests use a fake RN buffered HTTP 200 Responses reply, strict output, cancellation and raw-body redaction; no network/key is needed.

## Nomad and Todoist

Target `SN078D10010594`, firmware `Chauvet.E103.2609111001.2505_beta`, PluginHost `1.00.26009090` / code `1002609090`.

- Existing package/shared settings/data were backed up in ignored local build files before replacement. They contain private data and must not be committed or shared.
- Full beta.1/beta.2 installations verified native private storage, private Settings source and redacted shared token/debug URL, without printing credentials.
- Wi-Fi off: manual review split ten labeled lines into ten rows and saved them atomically. Pending showed ten queued tasks plus eight cached active tasks.
- Full PluginHost stop/restart while offline: all ten queued tasks and cached projects remained available.
- Wi-Fi restored + Refresh: queue reached zero. Independent Todoist read verified ten active test tasks with ten unique titles, without duplicates.
- Offline complete: one queued command and task moved to Done. Reopening after reconnecting synced automatically; Todoist showed nine active test tasks.
- Offline reopen from Done: one queued command and task returned to Pending. Reopening after reconnecting synced automatically; Todoist again showed ten unique active test tasks.
- Deleted only the exact labeled test tasks. Independent read confirmed zero remained. SuperTask returned to the original eight active tasks and zero queue; Wi-Fi restored on. No user note was edited.

The live batch used **manual input**, not handwriting. Actual uncertain-response replay, partial failures, auth expiry and project deletion were simulated locally rather than induced in this account. Open/resume and Refresh synchronization were directly verified; foreground reconnection polling is implemented but was not separately timed.

## Artifact

`C:/Users/pless/Code/Supernote/SuperTask/plugins/SuperTask/build/outputs/SuperTask.snplg`

Version `0.4.0-beta.4`, code `8`, 7,511,522 bytes.

SHA-256 `5fc00cbcb64695843a91f8f334f88251bfd6a18d222b7e24dfb4fa8f60412a73`.

Outer archive contains bundle/icon/config/`app.npk`. ReactPackages: custom NoteOpenerPackage, RNFS, RNGetRandomValues. Nested DEX contains TaskStorage, NoteOpener and random-values modules. Only `lib/arm64-v8a/libnative-lib.so` is retained; host-owned libraries are excluded. `config.local` is absent. Final beta.4 adds interrupted-capture/late-element cleanup, migration warning display and stricter recovery validation and account-switch cache isolation to tested beta.2 behavior.

## Pending manual checks

1. In a **scratch note**, write ten lines including a wrapped task and explicit date. Lasso → Add Task. Expect editable native OCR rows, unchanged handwriting. Record collapsed lines/recognition errors. Review with finger/keyboard because of the upstream EMR issue.
2. Merge, split, exclude/remove and edit rows; set individual metadata then Cancel. Expect no created queue. Repeat offline and Save; expect selected count and whole batch retained across restart.
3. Open a saved task's source link before/after sync. Expect correct scratch note/page. Rename/move the scratch note and verify navigation/healing; missing files must fail visibly.
4. Configure the separate AI key. Refine reviewed scratch rows; expect validated editable suggestions and capture-date interpretation. Undo restores edits. Stop/close/disconnect/deny permission/clear key must retain original rows without automatic creation. A real API call may incur charges; none was made here.
5. Repeat in landscape and near page edges; verify crop rotation and native line fidelity.
6. Optional dedicated test-account faults: lose a real reply after acceptance, restart and replay identical UUIDs; verify mapping retention/no duplicates. Exercise partial rejection/deleted project/429 independently, without touching unrelated tasks.

These are pending checks, not claimed passes. The user permits a handoff with this exact deferred checklist. SuperDashboard remains deferred.
