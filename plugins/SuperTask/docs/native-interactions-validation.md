# Native interactions beta verification

This record distinguishes automated checks, scratch server evidence and device checks. Specification: `NATIVE_INTERACTIONS.md`; activated goal: `NATIVE_INTERACTIONS_GOAL.md`. Beta.12 is the last installed and hardware-inspected version. Beta.13 is a separate combined testing artifact.

## Server contract and scratch cleanup

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
