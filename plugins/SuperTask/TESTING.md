# Combined SuperTask testing

## Connected device follow-up — 5 October 2026

The Nomad `SN078D10010594` reconnected. Beta.13/code 18 was installed through Select Plugin Package from the exact inspected file and enabled ON; Plugin Manager displayed **0.4.0-beta.13**. Startup and the new runtime UI were inspected: Settings/Close header, pane menu, contextual inline composer, plain project sidebar with fixed New project, and expanded cached Completed footer without an Undo banner. Initial cache showed 24 tasks / 0 queued. Configuration before/after installation was identical; backup remains in ignored `build/device-beta13-backup`. No scratch or real tasks/notes were modified, and no AI request was made.

Completed-history refresh reported unavailable; saved history remained visible. This is not a successful remote-history refresh claim. Physical gesture/pen/capture, offline mutation and full action flows remain pending. The legacy `MyStyle/Plugins/SuperTask.snplg` copy still contains an older package, so always select the separately named beta package explicitly for installation rather than reinstalling that legacy file.

Visual inspection found missing dotted separators in the new Inbox list. The shared TaskRow now owns the dotted rule across views and duplicate legacy list separators are removed. **Beta.14/code 19** is built from `70508ac1518a2996f7e053726bafd28981d8dfc6`: `build/outputs/SuperTask-native-beta14.snplg`, **7,586,181 bytes**, SHA-256 `5fe90ff075e9e55275bb32105eda5420b4892df04eaa9985d8d638c3648ce57f`. All 236 tests, full TypeScript/lint error checks, native/JS build, actual archive verification and complete Hermes compilation pass. Installation is awaiting release of screen control from the user-authorized Obsidian testing chat; no overlapping ADB taps/app launches are performed.

The records below precede this connected follow-up; beta.13's former unavailable-device status is historical.

## Current native interaction beta — 5 October 2026

Integration branch: `release/workflow-overview-testing`; packaged runtime revision **a70aa6a1f03c595f85c140014a5edcca23a71037**. All nine current remote feature heads pass ancestry verification through `syncTestingBranch.ps1` without additional changes. Main and the earlier six draft PRs remain unchanged.

| New feature | Included head | Draft review base |
|---|---|---|
| Durable offline location/order/bulk engine, PR 7 | `34f96a5c90bb985278941660d5479d39f5ea178f` | `review/native-interactions-base` |
| Native launcher and recognition, PR 8 | `5aa3e97` | `review/native-interactions-base` |
| Native workspace and safety follow-ups, PR 9 | `922399abf078d3fa78fcf08dc7e7e9753d9d0aba` | `feature/native-interaction-engine` |

Artifact: **0.4.0-beta.13**, code **18**, `build/outputs/SuperTask-native-beta13.snplg`; **7,586,231 bytes**, SHA-256 **d0263e10675b2fc81923f27a737cf2d15f18d346f655d64f11ce301e009ebac5**. Final combined **236/236 tests passed**, none skipped/cancelled. Full TypeScript and ESLint error checks passed. Full debug native/Metro build, actual snplg/nested native archive verifier and full pinned Hermes bundle compilation passed. Native manifest inspection includes SYSTEM_ALERT_WINDOW; SDK/RN/React pins and package registrations/classes/ARM64 library match the source. Metro resolves the shared npm dependency junction without changing the lockfile or third-party clones. Inherited SDK/Gradle/Hermes/dependency warnings remain; no audit-clean claim is made.

ADB sees no connected device. **Beta.13 has not been installed or hardware-verified.** The last verified installation remains beta.12. [Native verification handoff](docs/native-interactions-validation.md) records exact pending scratch workflows, server contract evidence, cleanup and platform limits. In particular the launcher is off by default and lacks SDK scoped pen exclusion; strict gesture thresholds require device traces. Remote retention is disabled when complete history/descendant scope cannot be proved. Paid AI requests remain **1 of 100**.

The following beta.12 record and its task counts are historical, not evidence of the new runtime.

## Historical beta.12 integration

Current integration: `release/workflow-overview-testing`, runtime integration HEAD `99dd6e166cf3d52302f6da61db7a9dc2210f955b`. This is a private testing branch, not a release. Six feature histories and their testing helpers are included; nothing is merged to main or published. All six feature heads were verified as ancestors of this integration.

| Feature history | Included revision |
|---|---|
| Offline queue, private settings/cache, batch review and optional AI | `4298b22457b60851b30cf008b828a9e0ee7c5cc9` |
| Expandable project overview and native-inspired density | `be97009d6973090d0440f0239ea90f77f51285ee` |
| Project collections across cache, overview, forms and structured AI | `a02e5ee2de5b303bab628a570a2652ef90f06c85` |
| Offline mutations and collection dependencies (PR 4) | `8e12d886403d4edbeeb01a02b28983a1978b6fcb` |
| Native-style sidebar and shared task actions (PR 5) | `dd81300801bc0f74f854b2882936fa815838e829` |
| Capture, batch and AI settings (PR 6) | `8742e3c0f534a2d9e75e8c13c369b2180fcde720` |

Draft PRs 4–6 remain separate/reviewable. Earlier PRs 1–3 remain in history. The runtime integration includes all six feature histories; all six head ancestry checks passed.

## Current artifact and validation

- **0.4.0-beta.12**, code **17**: `build/outputs/SuperTask-feedback-beta12.snplg`
- Size: **7,537,391 bytes**; SHA-256: `c3d0e0c20bd82436dedd1cc23b60cc61d063267aa2f68035266b37c66d4ff4eb`
- **161 tests passed**, full TypeScript and lint checks reported zero errors.
- Full native/JS build and package verifier passed against the actual `.snplg`.
- Inherited dependency audit warnings remain. This is not an audit-clean release.

## Device validation

Beta.9 and beta.10 behaviors below were verified on device and remain unchanged in beta.11. Beta.11 was installed/enabled and started successfully: the device displayed 20 tasks and 0 queued changes, matching the fresh server snapshot. Beta.12 adds the requested sidebar/footer polish; Plugin Manager confirmed version 0.4.0-beta.12, enabled ON. Startup and hardware layout inspection passed: All projects is below Projects, and both footer actions match the header buttons.

- Beta.10 is installed/enabled ON; startup succeeded. Ask → Batch → Details → Back preserved the saved list and Add another opened a fresh empty review. Main Settings AI section/model/masked key were inspected without changing values.
- Beta.9 batch/device checks produced exactly two labeled tasks and one collection offline, mapped to that same collection, with due dates 2026-10-05/2026-10-04 and priorities P2/P1. A manual P2 and explicit AI P1 survived a later batch P3 assignment. Server readback verified the records.
- An acknowledged task's description edit and move to No collection were made offline, synced and remotely verified. Acknowledged-task deletion appeared as a tombstone in the sync summary offline and remote readback confirmed absence after sync.
- A daily recurring task completed offline immediately left the active list; host restart retained the completion. After sync, remote readback showed exactly one active task in the same series, due 5 October; no second completion occurred.
- One paid text-only AI request proposed “Codex-beta9 water plants tomorrow” as 2026-10-05/P4 and “Codex-beta9 important call mom today” as 2026-10-04/P1. Editable source titles remained and results entered review; no task was saved by the AI check. Paid request count: **1**. This does not verify handwriting-image timing, orientation or crop behavior.
- A live offline conflict retained the remote description and cleared the queue; final device readback confirmed remote value `True`.
- Scratch cleanup was verified: the three beta.9 labeled tasks, test collection, beta.10 deleted-task test and old `Codex-collections-scratch-20261004-A` were removed. No unrelated tasks were touched. Wi-Fi is ON; Today is restored and the active cache count is verified.

## Verified cache reconciliation

Earlier UI cache showed 31 active tasks; a fresh server read returned 20 active tasks, all with `is_completed=false`. Do not describe the prior cache count as authoritative or imply the active records had all synced. Beta.11 adds reconciliation for remote-missing owned tasks: full active snapshots hide absent acknowledged tasks from active lists/counts/source views without deleting their private cached records or recovery tombstones. Pending/new/acknowledgement propagation guards remain. Explicit completed-history reconciliation can safely settle missing owned tasks and excludes active recurring series; aliases normalize after reopen. The shared `privateTasks` service/cache subscriber feeds UI while the public snapshot remains filtered.

Verified on beta.11: startup and 20 active tasks / 0 queued changes match the server; stale acknowledged ghosts no longer inflate active counts. Queue/tombstone/history preservation has automated coverage. Beta.12 places All projects immediately below Projects, adds 6 px header bottom margin, and uses header-style buttons for Refresh and Show done, with inverted selected styling for Show done.

## Remaining hardware and live-test checklist

1. Handwritten capture: lasso/doc image-first preview timing, orientation, landscape/edge crops, OCR/AI race, cancellation/timeout/fallback, lifecycle interruption and source-note return. The paid AI check was text-only.
2. Live lost-response behavior, a genuinely remotely advanced recurring-occurrence guard and induced native storage-write failure have deterministic simulated coverage only; no account/device injection was performed.
3. Render tests cover 150%/200%; device font-scale options top out at 130%, and no larger preference was changed. Verify available scale, touch targets, scroll and e-ink redraw if needed.
Beta.12 sidebar/footer layout passed hardware inspection. Show done toggled selected true then false; Refresh retained 20 tasks / 0 queued. The original off toggle preference was restored.

## Known behavior and limitations

Undo for recurring completion is available only before its first send. Todoist determines the next recurring date when completion synchronizes; no authoritative next date is fabricated offline. Remote preflight comparison has a read/write race because the server offers no conditional mutation. Downgrading to an older beta while schema-2 operations are queued is unsupported. Inherited dependency audit warnings remain. No main merge, release publication or upstream maintainer action has occurred.

## Historical beta.8 record

Beta.8/code 13 was an earlier collections checkpoint. Its artifact was `build/outputs/SuperTask-collections-beta8.snplg`, 7,516,264 bytes, SHA-256 `d2863a59a7f5a689e8018741692287185ba1261357fe6d12d0441710cffba5f2`. Its installation and 51-test evidence are historical only.

## Maintaining the integration branch

Use `syncTestingBranch.ps1` only from a clean integration checkout and verify current feature refs/ancestry. It preserves history and stops on conflicts; it does not install packages, publish releases or merge PRs into main. For runtime changes, rerun relevant tests, TypeScript, lint, full build and verifier; increment version/code, inspect the actual archive and update this artifact record. Documentation-only changes do not require a rebuild.

See [FEEDBACK_IMPLEMENTATION.md](FEEDBACK_IMPLEMENTATION.md) for shipped behavior/evidence, [FEEDBACK_PLAN.md](FEEDBACK_PLAN.md) for approved scope and acceptance criteria, and [VALIDATION.md](VALIDATION.md) for older package records.
