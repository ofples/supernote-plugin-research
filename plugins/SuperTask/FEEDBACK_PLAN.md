# SuperTask workflow follow-up preparation

Prepared 4 October 2026 from the user's feedback and current beta.8 source. This is the preparation for a subsequent unattended implementation session, not an activated goal or a claim that these changes are implemented. SuperDashboard, InkToClipboard and the parked recognition-enhancer remain outside this work.

## Confirmed decisions

- Batch assignments affect included rows and preserve fields explicitly overridden in an individual row. New rows inherit current batch defaults.
- Offline changes to an existing task remain local if the remote version has not changed. An actual remote conflict uses the remote task and produces a brief sync notice; no conflict-resolution screen. Newly created offline tasks are never discarded under this policy.
- Create collections from task forms, including offline creation and queued synchronization.
- Sidebar projects are a plain list beneath a Projects header. They do not collapse or expand. Selecting a project shows its collections in the main task pane only.
- Keep All projects as a separate sidebar item for the existing broad overview, with expansion controls in its main pane. This does not add expandable sidebar project entries.
- AI may assign known projects/collections only when the task explicitly names them: for example `in House`, `project: House`, or `House / Cleaning`. Ordinary task meaning is insufficient; ambiguous matches retain the current/default location.
- During capture, device OCR continues in the background even after AI is requested. Its result is ready for AI failure or an explicit switch to device OCR. Keep the configured AI button visible across Wi-Fi changes, with a bounded timeout and Cancel / Use device OCR controls.
- The user authorizes up to **100 AI requests** for this unattended session's scratch verification, using the configured SuperTask key. This is a ceiling, not a target; use only calls justified by new changes or unresolved results. Never send real notes as test data.
- Include offline completion of recurring Todoist tasks' current occurrence. Preserve the recurring series and let Todoist resolve its next occurrence during sync, with duplicate-safe retries and tests for delayed synchronization.
- Use Luna agents for bounded implementation tasks and Sol for orchestration, reviews and difficult coding, as specified in [FEEDBACK_GOAL.md](FEEDBACK_GOAL.md).
- If the device is unavailable, continue all independent implementation, review, tests and packaging, with an exact deferred device checklist. Avoid idle waits, repeated device polling, redundant exploration and unnecessary test/agent work.

All preparation questions are resolved. [FEEDBACK_GOAL.md](FEEDBACK_GOAL.md) is the ready-to-run goal prompt for the subsequent unattended session. Preparation is complete; runtime implementation has not started.

## Current baseline and device handoff

The combined branch is `release/workflow-overview-testing`, integrating the three existing draft PRs. Beta.8 is **installed and enabled** on the Nomad. Private settings/cache startup and the full-width collection rules in the projects overview were verified on 4 October. The device disconnected before the dedicated project view, batch/default/large-text checks and scratch cleanup. See [COLLECTIONS.md](COLLECTIONS.md) and [TESTING.md](TESTING.md) for exact evidence and artifact hash.

The known scratch task `Codex-collections-scratch-20261004-A` remains in House / No collection. The last observed account had ten active tasks and zero queued changes. Remove only this test task and any newly labeled test data when device access returns; preserve subsequent user work. No device or note changes are part of this preparation.

Runtime pins remain React Native 0.79.2, React/renderer/types 19.0.0 and sn-plugin-lib 0.1.65. The existing package has 51 passing deterministic tests plus TypeScript, changed-code lint, a complete native build and nested package inspection. Those checks validate the baseline, not this proposed work.

## Interface and interaction

Use the native Supernote To-Do app's previously captured device layout as the visual reference: a left navigation pane, large round checkboxes, understated separators, and a task list on the right. The private reference screenshot is `build/native-tasks.png`; never commit its real task content. Adapt the design to SuperTask rather than copying native task data or changing native app behavior.

Sidebar order: Today, Tomorrow, Upcoming, Inbox, This Note when a note is open, On Device, Done, All projects, then the Projects header and a scrolling plain project list. Inbox remains directly reachable. Projects stay visible without a group-expansion step. Collections appear as grouped headers inside the selected project's main pane. Keep the user's full-width header rules.

Use one task-row component and shared mutation handling in all lists, including project, date, note, device and completed views. Checkbox tap completes immediately; tapping the task body opens its details. A completed checkbox reopens where supported. Remove the select-then-Complete interaction as the default. Preserve note/page navigation and deep links, density options and enlarged text. Completion can have an explicit Undo action without a timer that pressures the user.

This Note becomes a separate view, not a repeated band above every list. Preserve its established note-scoped task semantics. On Device retains its existing captured/source-linked meaning. Migrate old saved tab/view identifiers, default destinations and last-opened state to the new navigation so existing settings remain useful.

Remove Pending from primary navigation. Show a drawn monochrome unsynced symbol on affected task rows, with an accessible label and a distinct needs-attention state. A tappable sync summary opens queued changes, errors and retry controls; this must also expose deleted tasks and pending collection operations that have no visible active row. Keep last successful sync and cached-data age available.

Replace the form picker accordions with compact wrapping project buttons. Beneath that button list, show a separate compact collection choice list for the selected project only, with No collection when there are collections. Do not render an empty Collections heading/explanation for a project without collections. Offer New collection for the selected project as an inline name/commit/cancel flow, including when it has no collections yet. Use the same picker in task add/edit, row Details, batch defaults and default-task Settings. Distinguish selected state visibly and clear incompatible locations when changing project. This form layout is separate from the plain sidebar project list.

## Batch review

Place the batch assignment controls and Refine with AI at the top, outside the task-row scrolling area where practical. Use the existing outlined/inverted button language, wrapping or compact popovers at larger text sizes rather than an overflowing toolbar.

Provide Today, Tomorrow, Custom date and No date; project/collection; priority; and labels. Description remains a row-level field unless a clear batch use case arises. Include Select all / Select none and Add row without pushing the primary controls to the bottom. Keep merge, split, remove and row Details available.

Represent batch defaults separately from per-row values and field-level overrides. Changing one row's date must not stop its project from inheriting future batch project choices. Resolve fields in this order: explicit individual edit, explicit task/AI instruction, batch default, configured default. A project override and collection override are a paired location: never preserve a collection under an incompatible project. Provide a way to return a row field to the batch default. Excluded rows are not changed by a quick assignment, and new rows inherit the latest batch defaults.

Use Today/Tomorrow consistently in both batch and individual date controls; add Tomorrow to the shared calendar footer. Remove Captured today as an action label. Date shortcuts resolve when chosen into concrete calendar dates, never when the queued change finally reaches Todoist. AI-relative dates resolve against the original capture's local date. Preserve existing recurring/timezone information on unrelated edits.

Saving is still one durable, atomic batch commit with stable task identities across uncertain responses. Keep the batch immutable after an uncertain save until its state is reconciled, rather than enabling a second submission with different content.

Honor the existing post-create setting for single and batch flows. Ask shows the locally created tasks as a tappable list, plus Done and Add another; task details work before server acknowledgement. Returning from details returns to the same created-task list. Add another starts a new save identity. Go back skips that confirmation: a note capture closes to its source note; manual entry returns to its originating task view. Do not report saved tasks as synced until acknowledged.

## Capture and AI

Refactor capture into independent context/preview, native OCR and optional AI work. Generate the lasso preview and note/page/bounds context before OCR finishes. The official `generateLassoPreview(imagePath)` API does not require recognition output, and is present in the installed SDK. This makes an image-first AI path feasible; the real device must still prove image timing/orientation/edge behavior.

Show Refine with AI immediately when a key is configured. Tapping it requests one structured image-recognition call without waiting for OCR. OCR continues concurrently. Once AI has been requested, a later OCR completion is stored as fallback and must not navigate away from the AI wait screen or overwrite its eventual result.

Use an explicit capture state machine with one winning result and a generation identifier. Bound the AI request (90 seconds maximum), expose Cancel AI / Use device OCR, and allow use of OCR as soon as it is ready. If OCR is still running when chosen, continue showing its progress. On AI failure or invalid structured output, use the OCR result or wait for it to finish. If both fail, offer retry and manual entry. Closing/canceling the capture or a lifecycle interruption aborts AI and prevents late navigation; do not release native elements while OCR still uses them.

Reuse the existing Vercel AI SDK Responses adapter, private key, model setting, structured validation and Undo refinement behavior. The capture shortcut and review button must use the same task extraction/location rules. AI suggestions still enter editable review and never automatically save tasks. No retries that cause repeated paid calls without another user action. Treat handwriting and supplied text as data; never let them change settings or invoke actions.

Projects and collections must come from cached metadata, including valid local pending collections. Only explicit, uniquely resolvable names change location. Examples: `Sweep the floor in House` selects House; `Buy bulbs in House / Shopping` selects that collection; `Sweep the floor` retains the current location. Unknown/ambiguous names retain location and flag a review hint. Locally validate every returned ID and project/collection relationship.

Preserve manual metadata overrides through refinement, merge and split. Extend the structured proposal contract with validated source-row references or an equivalent deterministic mapping so AI cannot silently lose individual overrides when it changes row boundaries. Explicit task dates/priorities may refine defaults, but never override a subsequent manual field choice. Refine selected rows only; a crop containing excluded writing must not reintroduce those tasks.

Merge AI configuration into main Settings, preferably its existing Setup area, using shared key/model fields rather than a duplicate screen. Existing stored credentials survive migration. An unconfigured user sees a dismissible Set up AI hint near capture/review; dismissing it is persisted and does not remove access to Settings. Configured AI remains optional and each request is explicitly invoked.

## Durable offline changes

Extend the private transactional store and outbox to editing, moving, deleting and collection creation, as well as existing create/complete/reopen operations. All task details supported by the form must be editable offline. There should be one write path online and offline, with a durable local commit followed by sync, so actions no longer branch into network-only REST mutations.

Update the interface immediately after the local transaction succeeds. It should never wait for a network acknowledgement before showing the edit/completion/delete. Storage failures must visibly fail or restore the action; a task must not appear saved after a failed disk commit. Transient sync failures leave the saved overlay and update status later.

Retain stable IDs, frozen command UUIDs/payloads after first send, account verification, serialized writes and restart-safe acknowledgement. Introduce a backward-compatible store migration with saved prior generations. Older installations must reject an unsupported newer store without overwriting it. Document that downgrading to an old beta while new operation types are queued is unsupported.

Store base remote state separately from local desired state. Queue only changed fields, retain deletion tombstones until acknowledgement, and keep source-note metadata after moves. Coalesce safely unsent edits; fold changes into an unsent task create; cancel an unsent create without a remote delete. Operations that may already have reached the server must first reconcile their original UUID before a subsequent edit/delete can run.

Collection creation gets its own stable local ID, command UUID and temporary-ID mapping. Dependent task create/move operations wait for acknowledgement and the real section ID before freezing their payload. Do not misfile a task if collection creation fails. Show the new collection immediately in cached pickers/project groups with pending status. Repeated requests/restarts cannot create duplicates. Validate names/project availability, surface an existing-name choice, and keep canceled forms from accidentally creating collections before the user commits New collection.

Use Todoist's documented Sync commands for task updates, moves, deletes and section creation, verified during implementation against current official documentation. A move selects one destination, not conflicting project and collection arguments. Each command needs individual acknowledgement; HTTP 200 is insufficient. Do not rewrite frozen dependencies after a lost response.

## Conflict policy and synchronization

Before sending a never-sent mutation of an existing task, fetch its current authoritative state and compare it with the remote baseline captured before the local edit. Compare normalized task fields rather than device timestamps. If unchanged, keep/send local changes. If remotely changed, retain the remote task, cancel only the relevant safely unsent task operations, and show a short persisted sync notice. Preserve a private diagnostic copy of superseded local changes for recovery without presenting a conflict editor.

Do not discard new offline tasks or shared collection dependencies because another task conflicts. A remotely deleted task is not resurrected; distinguish completed/deleted/missing state from an incomplete active-task snapshot. A deleted/archived destination must be reported with corrective action rather than silently changing project/collection.

Reconcile uncertain/sending commands before conflict decisions: an observed remote change may be our own successful request whose response was lost. For ordered update/move/complete operations, advance the expected remote baseline after acknowledgement so our earlier operation is not mistaken for an external conflict. Fetching metadata is not an atomic server compare-and-set; document the remaining concurrent-change window instead of claiming an absolute no-overwrite guarantee.

Synchronization remains on open/resume, manual sync and foreground reconnection. No unattended sync while every plugin is closed is required. Keep bounded retries/backoff, 429 handling and account isolation. Include recurring occurrence completion offline: retain the occurrence and local completion time, avoid treating recurrence as permanent task deletion, and verify the official recurrence command/timing semantics rather than replaying a server-relative date blindly. Retrying the same queued completion must never advance the series twice. If the remote occurrence changed while offline, apply the agreed remote-wins policy rather than completing the new occurrence accidentally. Do not fabricate an authoritative next due date while offline; show its pending state until Todoist confirms it. Define and test any Undo limitation explicitly, especially after server acknowledgement.

## Status and settings correction

Replace raw Network request failed with helpful saved-work status: for confirmed offline state, `You're offline. Reconnect to sync X tasks.` Count unique affected tasks, and mention pending collections/other changes when appropriate. No queued tasks should show a misleading zero-work warning merely because only a collection is waiting.

Keep authentication, permission, rate-limit, server and reachability failures distinct. A bad token must not be labeled offline. Avoid calling Wi-Fi enabled equivalent to Internet reachable. Confirm available host connectivity APIs before adding native dependencies; a failed request can show a neutral can't-reach-service message when network state is unknown. Diagnostics must redact credentials, API bodies and real task content.

The project-visibility bug is confirmed in source: TaskHome interprets legacy `enabledProjectIds: []` as all visible, while Config checks only membership and displays none checked. Its first toggle then unexpectedly changes all-visible into a single-project filter. Normalize visibility in one shared model used by Settings, the sidebar, counts and applicable list filters. Distinguish all visible from an explicitly empty selection, preserve existing nonempty selections, persist across restart, and keep Inbox directly accessible. New projects and unavailable IDs must have explicit, tested behavior. Do not fix only the checkbox rendering.

## Implementation order and Git layout

Preserve existing draft PRs and their comparison bases. No history rewrite, main merge, upstream Jira update or release publication. Use the current reviewed integration as a fixed baseline for follow-up branches; record its exact revision at session start. Prepare focused dependent PRs in the user's fork rather than broadening old PR diffs with the entire redesign.

1. Offline mutations, recurring occurrence completion, collection creation, migration and conflict policy. This is the shared foundation for immediate completion and all offline forms.
2. Capture/AI concurrency, batch defaults, dates, post-create flow and integrated AI Settings. Build on the offline foundation, with a PR that clearly records its dependency.
3. Native-style sidebar, common list actions/row status, This Note view and visibility correction. Keep the navigation/UI change separately reviewable.
4. Merge all follow-up feature heads into `release/workflow-overview-testing` and update its branch maintenance helper and included revision table. Never infer feature integration from matching filenames; verify ancestry.

Commit cohesive, validated milestones with the configured author Ofer Plesser. Preserve lockfiles and SDK/runtime pins. Keep private task data, screenshots, keys, local config, source documents fetched for research and generated packages ignored. Build/review the combined result, increment the beta version/code, inspect the actual archive/native content and record its hash. Docs-only preparation does not require rebuilding beta.8.

## Acceptance checks for the unattended session

| Area | Required evidence |
|---|---|
| Visibility | Legacy all-visible renders checked; hide one, show one, hide all, newly fetched project behavior and restart are consistent with sidebar/list counts. |
| Offline writes | Existing task title/description/date/priority/labels/location edit, completion/reopen/delete and new collection survive process death and sync once. Failed storage writes never report success. |
| Queue dependencies | Unsent edit/create folding, uncertain create then edit/delete, collection then task/move, partial acknowledgement, lost response, restart and throttling remain duplicate-safe. |
| Recurring tasks | Offline completion identifies the current occurrence, survives restart, preserves the series, and advances it once on sync; a lost response/retry never advances twice; delayed sync and a remotely advanced occurrence follow the conflict policy; next due date/Undo are honest. |
| Conflicts | Unchanged remote accepts local work; genuinely changed remote wins with a notice; deleted remote does not resurrect; our own acknowledged/uncertain changes are not classified as conflicts; new tasks remain queued. |
| Batch | Quick fields affect included rows; independent overrides survive subsequent batch changes/refinement/merge/split; Add row inherits current defaults; project changes cannot retain an incompatible collection; invalid batch has no partial save. |
| Dates | Today/Tomorrow/custom/clear are observable in row summaries and payloads; midnight/DST/capture-date boundaries do not drift on later sync; unchanged recurrence is preserved. |
| Capture | AI can start before OCR; late OCR cannot replace AI; cached OCR fallback works on failure/timeout/cancel; lifecycle/close blocks late navigation; native elements/previews are released safely. |
| AI | Explicit unique project/collection mentions resolve; generic meaning/ambiguous names do not infer location; invented IDs and prompt-like task text are rejected; overrides and excluded rows are preserved; real installed SDK buffered-body parsing passes. |
| Navigation | Plain scrolling project sidebar; collections only in main pane; This Note appears once; each list uses shared row actions; checkbox completes immediately; body opens details; saved/default view migration and return navigation work. |
| Post-create | Ask lists locally saved tasks with details/Done/Add another; Go back returns correctly; retry never creates duplicate tasks. |
| Sync status | Unsynced/attention rows and summary agree; queued deletes/collections remain reachable; offline vs auth/permission/rate-limit failures show useful distinct messages. |
| Device/package | Exact installed beta/enabled state, native startup/private persistence, 100–130% text and scrolling, header rules, lasso crop orientation/edges, sidebar/row touch targets and scratch cleanup are separately recorded. |

Use deterministic transport/storage/SDK fakes for failures and concurrency, real installed SDK tests for structured parsing, and meaningful component interaction tests. Run the applicable full test suite, TypeScript and lint errors; build and inspect nested package identity/icon/permissions/classes/ARM64 registrations. Real hardware results remain pending if disconnected. Paid AI scratch tests are authorized up to 100 requests for this session when a key is configured; track actual request count and use only calls needed for validation. Do not print the key or invoke AI merely to detect connectivity.

## Authoritative references checked during preparation

- [Supernote generateLassoPreview](https://docs.supernote.com/en/api-reference/supernote-plugin/plugin-comm-api/generate-lasso-preview), [recognizeElements](https://docs.supernote.com/en/api-reference/supernote-plugin/plugin-comm-api/recognize-elements), and [cancelRecognize](https://docs.supernote.com/en/api-reference/supernote-plugin/plugin-comm-api/cancel-recognize), queried through live official docs MCP and cross-checked against installed 0.1.65 source. Normal AI selection must keep OCR running per the user's instruction; cancelRecognize is for canceling a capture, only with verified cleanup semantics.
- [Todoist API v1](https://developer.todoist.com/api/v1/), downloaded from the official site on 4 October after the browser reader rejected its large size. It documents command UUID idempotency, temporary ID mappings, item_update/item_move/item_delete, section_add and recurring close commands. Recheck exact arguments/response behavior while implementing. No assumption is made about atomic conflict checking or device/server clock equivalence.
