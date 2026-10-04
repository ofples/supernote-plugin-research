# Feedback implementation handoff

Updated 4 October 2026. The approved FEEDBACK_PLAN scope is implemented across six feature histories on `release/workflow-overview-testing`, runtime integration HEAD `99dd6e166cf3d52302f6da61db7a9dc2210f955b`. This is a private testing milestone, not a main merge or release.

## Integrated behavior

- **Offline mutations and collections:** schema-2 private transactional storage, versioned migration/backup, durable outbox and foreground sync for task create/edit/move/delete/complete/reopen and collection creation. Durable local commits precede visible changes; stable IDs and frozen command identities support retry/reconciliation. Collection-dependent tasks wait for real section-ID mapping. Conflict checks compare normalized remote baselines and prefer changed remote state while preserving unrelated new work.
- **Remote-missing cache reconciliation:** a full active-task snapshot hides an absent acknowledged owned task from active lists, counts and source views without deleting its private cache entry or recovery tombstone. Pending/new task and acknowledgement guards remain. Explicit completed-history reconciliation settles missing owned tasks safely and excludes active recurring series. Aliases normalize after reopen. `privateTasks` is the shared UI/cache-subscriber service; the public snapshot remains filtered.
- **Recurring tasks:** closing an occurrence retains local completion time and waits for Todoist to compute its next occurrence on sync. Device test completed the 4 October occurrence offline, retained that state across host restart, and after sync observed exactly one active task in the same series due 5 October. Undo is only available before first send; no authoritative next date is fabricated offline.
- **Batch/capture:** batch quick dates, project/collection, priority and labels; individual overrides; add-row inheritance; merge/split/refinement provenance; capture-time dates; post-create Ask/Go back. Capture preview/context and optional AI may start before OCR completes, with cancellation, timeout, fallback and late-result guards. AI suggestions remain reviewable and never auto-save.
- **AI and forms:** explicit validated project/collection suggestions; shared AI settings in main Settings; persisted dismissible setup hint; compact accessible project/collection controls and inline collection creation. Existing private credentials/configuration are retained.
- **Sidebar and task actions:** native-style sidebar with plain project entries and All projects beneath the Projects header, header-style Refresh and Show done toggle buttons, shared immediate checkbox completion and details navigation, sync/attention row markers and a summary for queued work. Project-visibility semantics are normalized and persisted.
- **Navigation regression fix:** beta.9 lost the saved confirmation after Details navigation. Beta.10 preserved the form stack; hardware Ask → Batch → Details → Back retained the saved-task list and Add another opened a fresh review. Beta.11 includes subsequent cache reconciliation hardening.

For complete behavior and acceptance checks, see [TESTING.md](TESTING.md) and [FEEDBACK_PLAN.md](FEEDBACK_PLAN.md).

## Validation and artifact

- **161 automated tests passed**, including 14 remote-missing/cache regressions.
- Full TypeScript passed; lint reported zero errors.
- Full native/JS build and package verifier passed against the actual `.snplg`.
- Beta.12/code 17: `build/outputs/SuperTask-feedback-beta12.snplg`, 7,537,391 bytes, SHA-256 `c3d0e0c20bd82436dedd1cc23b60cc61d063267aa2f68035266b37c66d4ff4eb`.
- Inherited dependency audit warnings remain; this is not audit-clean.

## Device evidence and pending verification

Beta.9/10 checks below passed on device. Beta.11 was installed/enabled and started successfully, displaying 20 tasks and 0 queued changes, matching the server. Beta.12 sidebar/footer polish is built and Plugin Manager confirmed installation/enabled ON; runtime layout/toggle checking remains pending. A prior device cache showed 31 active tasks while a fresh server read found 20 active tasks, all with `is_completed=false`; do not treat the stale cache count as authoritative or claim those counts had synced. Beta.11 addresses this by reconciling full active snapshots while retaining private recovery data. Beta.11 startup/count verification passed against the fresh server snapshot.

Verified device behavior:

- Two labeled batch tasks and one collection created offline, both tasks mapped to that collection, and remote readback confirmed unique records. Due dates were 2026-10-05 and 2026-10-04; priorities P2 and P1. Manual P2 and explicit AI P1 survived a subsequent batch P3 assignment.
- An acknowledged task's description edit and move to No collection were made offline, synced and verified remotely. Acknowledged-task delete appeared as a tombstone in the offline sync summary and remote readback confirmed absence after sync.
- Daily recurring task created 4 October was completed offline, disappeared from active immediately, and remained completed after host force-stop/relaunch. After sync, the same series had exactly one active task due 5 October; no duplicate completion occurred.
- One paid text-only AI request preserved editable source titles and suggested dates/priorities for two scratch prompts. No task was saved by this check. Actual paid request count: **1**. No handwriting-image timing, orientation or crop result is established.
- Beta.10 Ask → Batch → Details → Back preserved the saved-task list; Add another opened a fresh empty review. Main Settings AI setup/model/masked key were inspected without changing values.
- A live offline conflict retained the remote description and cleared the queue; final device readback was `True`.
- Scratch cleanup completed: remote manifest confirmed removal of three beta.9 labeled tasks and the empty collection; beta.10 deleted-task test was absent remotely; the old `Codex-collections-scratch-20261004-A` was found and removed. No unrelated tasks were touched. Wi-Fi is ON; Today is restored and the active cache count is verified.

Still pending: beta.12 sidebar/footer button check; handwritten lasso/doc image-first timing, orientation/landscape/edge crops, OCR/AI races, cancellation/fallback/lifecycle and source-note return. Live lost-response, genuinely remotely advanced recurring guard and induced native write-failure checks have simulated coverage only. Font-scale tests cover 150%/200%; available device scale tops at 130%, with no larger setting changed.

## Known limitations and risks

- Undo for recurring completion is supported only before first send.
- Todoist chooses the next recurring due date when processing completion; the plugin cannot promise an authoritative next date offline.
- Remote preflight read then local write is not atomic: Todoist provides no conditional compare-and-set, so a concurrent server edit can land in the interval.
- Downgrade to an older beta while schema-2 operations are queued is unsupported; never overwrite a newer private store with an older runtime.
- Inherited dependency audit warnings have not been remediated in this milestone.
- No main merge, release publication or upstream-maintainer operation has occurred.
