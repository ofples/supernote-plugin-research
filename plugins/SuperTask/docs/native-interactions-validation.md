# Native interactions beta verification

## Beta.22 validation status — local checks and limited install verified

Runtime source `e851e34744739c0463bb75328b71c807ce11fe89` is from `feature/capture-review-polish`; testing integration and ancestry are managed through `syncTestingBranch.ps1`. Package **0.4.0-beta.22/code 27**, `build/outputs/SuperTask.snplg`, is **7,606,256 bytes**, SHA-256 `34ccedf5b05679b882b8e01af2db67de1fad53f0a88b97c03fcc5206bbf40723`. Verifier-only maintenance commit `98710a9a5160fc45913f76435c94ed04715647b4` followed without changing runtime source. The offline suite passed 316/316, TypeScript/ESLint reported zero errors, native build/package verification passed (including identity, config, icon, JS, native classes and ARM64), and pinned Hermes compile exited 0 (5,008,281-byte HBC, magic `c61fbc03`; warnings present, no errors).

Luna installed the inspected package through Supernote Settings > Apps > Plugins. Plugin Manager showed v0.4.0-beta.22 enabled ON; the exact beta.21 installer and temporary beta.22 installer were removed, leaving canonical `/storage/emulated/0/MyStyle/Plugins/SuperTask.snplg`. SuperTask Settings opened and General loaded. Tasks Today/Done switching worked; stationary multiselect preserved checkbox bounds and Cancel cleared it. AI-by-default remained unchecked. The **Workspace view options** control at `[1190,166][1288,241]` opened List/Board; Board was selected and rendered, then List was restored and the panel closed. No task/note changed. This verifies the beta.22 TaskHome runtime, but not board scope/columns, sort/group behavior, expanded-description geometry or preference persistence. Beta.21 hardware observations below remain historical.

The pending runtime review includes:

- Batch actions modal size, transparent undimmed background, no animation, stable Save/Saving/Retry control geometry, and task rows remaining in the primary viewport.
- Device OCR as baseline/fallback; explicit AI refinement consent, AI-by-default behavior only when enabled, model selection, cancellation/timeout, and image/text disclosure.
- OCR Lines/Paragraphs grouping before edits, bullet boundaries, wrapped-line joining, and manual newline split; title-description spaced-dash handling.
- Supported shorthand, retained unknown/conflicting directives, multiword project/collection matches, and unchanged row overrides.
- Account/view-scoped List/Board, grouping, sort and Completed expansion preferences across relaunch and account changes.
- Inline composer and active-task destination selection applying a project, collection, or No collection immediately (single task and multiselect); settings and other staged ProjectPicker flows should retain their existing behavior.
- Optional two-finger bottom-edge gesture cooldown/rejection behavior and optional launcher permission, position, rotation, hide, and coexistence behavior. Both need device evidence; the launcher remains off by default.

Pending: Board scope/columns; sort/group and Completed column; immediate composer/task/multiselect move destinations; expanded descriptions/selection geometry and workspace stability; preference persistence across relaunch/account switch; Batch panel behavior and grouping/splitting; handwriting OCR/AI capture fallback and cancellation; source-note return; physical gesture cooldown/rejection and optional launcher behavior. Update only from observed checks. No real task/note edits are needed for layout checks.

This record distinguishes automated checks, scratch server evidence and device checks. Specification: `NATIVE_INTERACTIONS.md`; activated goal: `NATIVE_INTERACTIONS_GOAL.md`. Beta.14 is installed/enabled and startup/layout/separators inspected; see TESTING.md for the exact artifact hash. Beta.12/initial beta.13 local-delivery records below are historical.

## Reconnected-device smoke check

Beta.13 was installed explicitly from the separately named inspected package. Plugin Manager version/enabled state and startup/new workspace controls were verified. Existing configuration stayed identical; no task/note changes or AI calls were made. Cached completed history rendered but remote refresh reported unavailable. Detailed mutation, gesture/pen/capture and launcher workflows are still pending; this smoke check does not establish them. Screen control was released to the user-authorized Obsidian testing chat to avoid simultaneous ADB interaction.

## Server contract and scratch cleanup

The later coordinated beta.14 installation passed Plugin Manager version/enabled confirmation, startup and actual dotted separator inspection. Multiselect/Select all covered 20 active Inbox tasks, including offscreen rows; Cancel cleared selection without edits. Configuration stayed identical and cache remained 24 tasks / 0 queued. Screen control was returned to the Obsidian chat. Remaining bullets below cover checks beyond this smoke validation.

On 5 October 2026, a read-only Todoist Sync snapshot confirmed active tasks expose current string `order_key` values. The implementation writes only the moved task's current ordering field after checking sibling membership/order, rather than overwriting unrelated remote fields.

An isolated, manifest-listed scratch project contained one collection and four synthetic tasks, including a parent and child. Completing those tasks showed that `completed_info` aggregates do not enumerate every nested completed task: project and collection counts cannot prove complete retention scope. The scratch project, collection and tasks were deleted only after checking their exact manifest identities and that no unrelated contents existed. Cleanup succeeded. No real tasks or notes were modified and no new AI requests were made.

Keep tasks remains available for fully known never-sent local containers. Remote containers explain why retention cannot yet be proved. Explicit Delete tasks too uses scope/count confirmation and refreshed permission/content preflight. Todoist has no conditional container delete; a remote change between final preflight and deletion remains a server-side race. An ambiguous response is retained for reconciliation under its original identity.

## Hardware checks deferred

Final local runtime revision: `a70aa6a1f03c595f85c140014a5edcca23a71037`. Beta.13/code 18 package: 7,586,231 bytes, SHA-256 `d0263e10675b2fc81923f27a737cf2d15f18d346f655d64f11ce301e009ebac5`. The combined 236-test suite, TypeScript, lint error checks, full native/JS build, actual archive inspection and full pinned Hermes compilation pass. Separate review PRs 7–9 are attached; all nine feature histories are integrated. Final runtime code is unchanged by the subsequent documentation commit.

ADB reported no connected device during final local integration. These checks remain pending for the new beta; earlier beta.12 checks do not establish new runtime behavior:

- Install and enable the inspected combined beta, preserve configuration, verify startup/cache and settings entry points.
- Inline composer keyboard/focus/draft retention, contextual destination/date, full editor return and scroll across navigation/rotation.
- Body expansion versus circle completion versus square multiselect; offscreen/collapsed Select all; labels/date/move/priority/delete scope; collection header menus and fixed sidebar New project.
- Completed footer paging/reopen; recurring occurrence identity and disabled reopening after first send; no completion Undo banner.
- Independent interaction while local writes and network sync run; visibly distinct Saving locally, waiting to sync and attention/retry states; account switch cancellation.
- Scratch offline project/collection dependencies, rename/delete confirmation, restart and uncertain replay; task order readback inside sibling groups and conservative remote conflicts.
- Optional launcher finger tap, drag, long-press Hide/Settings, persisted hide, permission refusal, rotation, plugin disable/process restart, other overlays and e-ink redraw. Default remains off. The SDK has no scoped pen exclusion; direct pen contact over its rectangle may still ink the underlying note. No full-screen pen lock is used.
- Strict three-finger bottom-edge swipe using actual device event traces; deliberate activation, missing/extra pointers, palm/pen rejection, slow delivery and cooldown. Thresholds have deterministic replay coverage, not hardware tuning evidence.
- Synthetic handwriting lasso/image preview, portrait/landscape/edge crops, concurrent OCR/AI, cancellation/timeout/fallback, dash title-description parsing, independent manual overrides and source-note return. Text-only earlier AI testing does not establish handwriting recognition.

Paid scratch AI request ledger: **1 of 100** used across the goal sessions. No real-note submissions. Device unavailability does not pause local implementation and does not justify marking the above checks passed.


### Beta.15 polish follow-up

239 tests plus type/lint/native package/Hermes checks pass. Icon overlays keep row height; arrows remain scroll-accessible at narrow widths. Collection headers have one faint divider and no count box; project menus appear only in the pane. Dialog buttons size to content, with adjacent name/save and labels/apply controls. History uses numeric HTTP status and bounded 89-day windows. Configured account history endpoint succeeds from the computer; device refresh remains pending.


### Beta.16 list-flow follow-up

Beta.15 remote history refresh is hardware-confirmed (22 active/0 queued). Beta.16 has 241 passing tests and package/Hermes checks. Completed is in the same list flow; white full-page action/calendar dialogs are undimmed/nonanimated; row icon borders align right with explicit Close; Projects has a solid divider. Device layout/first-frame checks pending coordinated screen availability.


### Beta.17 clarification and hardware caveat

Beta.16 row actions, dismissal and normal Completed flow passed hardware checks; a history warning recurred, so prior no-error observations do not prove remote history success. Beta.17 floating undimmed panels and successful-retry warning cleanup have 242 passing tests plus native/Hermes verification. Device dialog/history checks pending. Nine old installers removed; beta.16 canonical package hash verified, no task/note edits.

### Beta.18 collection/footer verification

Beta.18/code23 runtime `5dcccc1751558113d7697b54d80a11fc2d4b8d64`, workspace `dd406a7`. Artifact `build/outputs/SuperTask-native-beta18.snplg`, 7,587,153 bytes; SHA256 `4ae0e3b893a7bc5cd903fed597f926c2db113d831c6286c1eca974505c640e1e`. All 243 tests, TypeScript/lint, native package inspection and Hermes pass. One-line/ellipsis/fixed-height/accessibility/footer-opening regression passes. Nomad Plugin Manager confirms version and ON; House screenshot confirms full-width plain New collection and faint collection chip borders. Sync text bounds `[23,1791][1211,1825]` unchanged before/after Refresh. Long-message behavior covered by regression, not forced on hardware. Current canonical/installer hashes match; beta.17 installer removed. Inbox restored, no modal left open, no task/note changes or new AI calls. Existing broader pending workflow checks remain.

### Beta.21 responsive workspace verification

Artifact `build/outputs/SuperTask-native-beta21.snplg`, 7,589,382 bytes; SHA256 `094c64889c7f3c800474bfda7f8d97848f1c52981c4f485f67b21df9e871f26d`. Runtime source `8ce712c6814d9a0b24196ac1856dd23bea65eeeb`; workspace feature `76fc02a`, launcher feature `5023491`. Full 255 tests, TypeScript/lint, native identity/registration/classes/ARM64 inspection and Hermes pass. Complete snapshots, recurring history, no-op/status updates, unchanged row identity, account/stale-hydration guards, deferred scans, zero extra reference reads on cache updates, week-scope/count parity, collapsed collection selection, icon callbacks and stable one-line footer have regression coverage.

Beta.19 device checks: collection collapse/expand, undimmed content-height menu/calendar, continuous icon strip and dismissal, Select all/Cancel of 12 active Inbox tasks. Beta.20 alignment exposed overlap with host Home; beta.21 header reserve fixes it. Installed beta.21/ON verified; selected count `[1137,51][1292,92]` visibly clear of Home. Footer text `[23,1828][1237,1862]` unchanged before/after Refresh; 12 active/0 queued. Canonical and current installer hashes match above, obsolete beta.18/19/20 installers removed. Local rollback packages preserved, Inbox restored, no modal/selection open. No task/note modification or new AI requests; ledger stays 1/100.

Manual remaining checks: physical two-finger upward swipe from the bottom edge after the 1.5s pen cooldown (recognizer accepts 2-3 fingers; nine trace/rejection tests pass); quantified end-to-end touch latency and cold-process startup under weak/no network. Warm committed snapshots/no-op updates are covered, but screenshot inspection does not prove transient first-frame timing. Existing broader mutation/offline verification checklist remains.
