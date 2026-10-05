# SuperTask: interaction redesign

5 October 2026. Design checkpoint based on the five native To-Do screenshots supplied by Ofer and the verified beta.12 baseline (`5ec9531`). This document is the next implementation specification, not a claim that these interactions are already installed. Keep the existing offline queue, AI/OCR capture and account isolation. SuperDashboard widget integration remains deferred.

## Everyday workspace

Keep the sidebar's useful smart views and plain projects. All projects remains beneath Projects. Use an outlined selected sidebar entry, quiet dotted item separators, and a fixed **+ New project** footer outside the scrolling projects list. Retain task counts; do not count queued tombstones as active tasks.

The main pane has the current list/project name and one **…** menu. The application header needs only Settings and Close; debug actions move into Settings. Remove + New, + Batch and Show done from ordinary chrome. Lasso capture still opens its multi-row review; removing the manual Batch button does not remove capture.

Place **Enter task — description**, an optional calendar action and Add directly beneath the pane heading. Enter and Add both submit. Add is unavailable only for an empty/invalid draft or that draft's own unresolved local write. Keep keyboard focus and clear the committed text for another task. A small inline project/collection target makes the destination explicit; do not silently guess a collection.

| View | Quick-add destination and defaults |
|---|---|
| Project | That project, No collection initially; tap a collection header or + beside it to target that collection |
| Inbox | Inbox, no due date |
| Today / Tomorrow | Inbox unless explicitly changed; due today/tomorrow |
| Upcoming | Explicit chosen calendar date; no arbitrary inferred due date |
| This Note | Inbox/default project with the current note association retained |
| On Device | Explicit/default location; show the location rather than infer one from the device filter |
| All projects | Visible project/collection target required; remember the last chosen target |
| Done | History, no quick-add field |

Switching lists must not silently discard typed text. Retain an unsent composer draft and its explicit target; show the destination if it differs from the newly selected view. A task that leaves the current date filter after an edit disappears immediately without changing the view or scrolling position.

## Three distinct row interactions

1. **Circle checkbox:** complete/reopen. This never expands the row or enters selection mode.
2. **Task body:** expand one row in place. A modest outline and actions appear below the title: pen/Edit, Date, Move, Priority, Up, Down, Delete. Tapping another row transfers the expansion. Tapping it again collapses it. Pen opens the existing full editor; preserve the list's scroll position and selection when returning.
3. **Select mode:** enter with list … → Select tasks or a deliberate long press. Squares replace completion circles. The square and row body both select, never complete. The top action bar becomes Cancel, selection count, Move, Date, More and Select all. More contains Priority, Labels, Complete/Reopen as appropriate and Delete. Hide the quick-add field while selecting to avoid competing modes.

Use separate stable task IDs for selection, expansion and mutation state. A sync rerender must not convert selected tasks into different tasks. Select all means all active tasks in the current list/filter, including offscreen rows; show the count. Include completed rows only when selection was explicitly entered in the Completed/Done context. Switching views exits selection; opening a picker does not. Multi-selection across collections in one project is supported.

Bulk changes touch only the selected field. Moving tasks does not change priority, dates or description. Clearing a due date is explicit. Move chooses a project and then its collections, including No collection; a collection always belongs to the chosen project. Batch delete names the number of affected tasks and asks for confirmation. No network call blocks this confirmation or subsequent navigation.

## Completed tasks at the bottom

Replace Show done and the Undo banner with **Completed (count)** after the active rows. It is collapsible and remembers its state per view; initially expanded so completion has a visible destination. Display recent cached completions first, newest completion first, and Load more for older history. Update the count immediately. Do not auto-scroll or auto-expand a section the user deliberately collapsed.

Ordinary completed tasks have checked circles; tapping reopens them. Recurring rows represent an occurrence, not the currently active next occurrence. Before first send, reopening reverses the queued completion. After send, retain the existing restriction: explain that this occurrence must be changed in Todoist, and never uncomplete or accidentally complete the next occurrence. Do not present an enabled checkbox that silently fails.

Background completed-history fetching may update the section without replacing active rows or showing a full-screen loader. Use cached due/project/collection and completion occurrence metadata for filtering. Missing historical metadata is not grounds to assign an occurrence to the wrong smart view. The Done sidebar remains a broader history view.

## Visual treatment

- Thin dotted separators between task and sidebar items. Use a device-tested mid-gray, initially #999; avoid a shade so faint that e-ink loses it. Collection rules remain full width, and selected rows use a solid outline.
- Round completion circles; square selection controls. Keep at least 44 logical-unit hit targets with separated actions.
- Titles carry most of the visual weight. Show concise date/location metadata only where useful; avoid repeating project names inside their own project.
- Description preview is one short secondary line, optional in density settings. Expanded/full editing exposes all text.
- Compact monochrome icons with accessible names; labels in menus. No dependence on hover, animations, color or swiping a row.
- Row actions wrap below the title at larger text sizes. No clipped title to make room for six tiny icons.

## Projects and collections

**New project** is fixed at the bottom of the sidebar. Selecting a project shows collections in the main pane. **+ New collection** is available beneath the collection list and in the project menu. Newly created projects/collections are immediately selectable while offline, using stable local IDs.

Project menu: Rename, New collection, Delete project. Collection menu: Rename, Delete collection. Inbox cannot be renamed or deleted. Respect Todoist workspace/share permissions; read-only locations do not show misleading enabled edit actions.

Deletion is a separate flow because Todoist's project and section deletion cascade into contained tasks. Default the dialog to **Keep tasks**: move a deleted collection's tasks to No collection; move a deleted project's tasks to an explicitly selected surviving project/Inbox. Offer **Delete tasks too** as an explicit destructive choice with a count and confirmation. Preserve parent/child structure and handle descendant projects; do not silently flatten subtasks. If all descendants and completed history are not cached offline, restrict Keep tasks to a verified complete scope or defer it with a clear reason. Never promise an offline move of unknown children.

The operation is a durable dependency chain: retain-content moves acknowledge before the container delete can be sent. A failed move keeps the delete queued for attention. For delete-with-content, retain private recovery metadata until the server confirms the parent deletion. Concurrent remote edits use the established conflict policy and must not cause stale queued parent deletion to erase newly moved/created remote content. Unsent local container creation plus deletion can coalesce only when no dependent task operations remain.

Official reference: [Todoist API v1](https://developer.todoist.com/api/v1/), including project/section deletion and ordering. Documentation fetched into ignored `build/todoist-v1-reference.html` for the design audit. Exact endpoint/command arguments must be checked again during implementation, rather than copying older `child_order` recipes.

## Ordering

Confirmed: sync manual task order with Todoist **within a project/collection**. Up/down moves relative to adjacent active sibling tasks in that same container and parent hierarchy. Do not move across collection boundaries or change a task's parent implicitly. Preserve relative ordering when completing/reopening; append new tasks at the end of the target active group.

Today/Tomorrow/Upcoming retain their calendar group order. Disable/hide arrows where a date sort is authoritative; Move handles location changes. All projects retains project grouping and applies manual ordering within the expanded groups.

Use the API's current ordering field/command and the remote group's real sibling snapshot. Persist local neighbor intent and the remote baseline for queued reorders. A remote reorder or changed membership is an actual conflict: refresh/rebase conservatively or retain the remote order, with a notice. Avoid rewriting every stale sibling's order and overwriting unrelated remote edits. Resolve temporary IDs before sending reorder commands.

## Reliable launcher and gesture tuning

Recommended, awaiting launcher preference: an optional movable **task edge button**, available above a note after closing SuperTask. Tap opens the last task view; drag relocates it without opening. Snap to either edge and persist a normalized position across rotation. Long press exposes hide/settings. No capture or AI starts merely by tapping the launcher.

The current `gestureDetector.js` has a 2+ finger bezel swipe based on primary `x/y` and a maximum-pointer count. It derives its bottom zone from the largest observed Y, and lowers displacement from 150 px to 80 px for 3+ contacts. The existing continuity and pen-cooldown filters help but do not prove coherent multi-finger movement. Therefore simply requiring three fingers is not a complete fix.

A stricter optional three-finger edge swipe should use stable `pointerId` tracks, known screen dimensions, a narrow bottom starting band, concurrent finger contact, consistent upward movement of all tracked fingers, bounded horizontal drift/duration and pen/palm cancellation. Reject incomplete/ambiguous event streams rather than fall back to a switched primary coordinate. Keep the current pen cooldown, prevent reentry while UI is open, and permit one launch per contact sequence. Tune thresholds with real Nomad traces; do not tighten the duration blindly because the existing comments report slow sensor delivery.

Live official docs verify that MotionEvent includes pointer arrays/count, event time and tool type, and that registerMotionListener returns a removable subscription. No public floating-window shortcut was found in the PluginManager method list. A launcher needs a native bridge, as in the local SuperDashboard reference, plus Android overlay permission.

Native launcher acceptance includes correct pen handling in the button's small rectangle, finger pass-through outside it, keyboard/settings/navigation coexistence, rotation, plugin disable, process restart and no orphaned duplicate buttons. Avoid full-screen EMR blocking; verify supported pen-disable/release behavior before enabling a persistent overlay. Prefer official lifecycle callbacks and conservative hiding over continuous expensive foreground polling. If the platform cannot reliably restrict it to a note canvas, expose an honest app scope and a quick Hide action. It must not obscure SuperDashboard's button or hijack other plugins' windows.

Official sources: [MotionEvent](https://docs.supernote.com/en/api-reference/supernote-plugin/types/motion-event), [registerMotionListener](https://docs.supernote.com/en/api-reference/supernote-plugin/plugin-manager/register-motion-listener), [PluginManager](https://docs.supernote.com/en/api-reference/supernote-plugin/plugin-manager/index). Cross-check implementation with pinned sn-plugin-lib **0.1.65**, React Native **0.79.2**, React **19.0.0**.

## Title and description extraction

Device OCR remains transcription; a deterministic parser organizes its output. Split at the **first spaced separator** ` - `, ` – ` or ` — ` into title and description. Retain later separators in the description. Thus `feed dogs - one bowl of kibbles each` becomes title `feed dogs`, description `one bowl of kibbles each`. Preserve ordinary hyphenated words, date ranges and minus signs. Leading list bullets are list markers, not empty titles. Do not treat every wrapped line as a new task; retain source transcription and let users merge/split during review.

AI may propose a concise action title and supporting description, preserving language, names, quantities, constraints and source-row provenance. It may organize implied explanatory text even without the dash, but cannot invent missing details. Explicit location/date/priority rules remain unchanged. Existing manually edited titles/descriptions win unless the user explicitly requests their refinement; store provenance independently for both fields. Every AI proposal is reviewable, with Undo available in capture review (the removal of completion Undo banners does not remove refinement Undo).

AI remains opt-in and nonblocking, with the existing concurrent OCR, timeout, cancellation, fallback and private key behavior. Recognition/refinement never saves tasks automatically. Do not rerun AI on every keystroke or task submission. Test examples include spaced dashes, hyphenated words, bullets, wrapped descriptions, multiple dashes, quoted text, existing overrides and explicit scheduling/location phrases.

## Instant interaction without weakening durability

Use an immediate UI overlay for user intent and keep the durable local mutation queue as the authority. Open menus, select rows, move visual rows, update counts and acknowledge taps in the next render; never await a network response in those flows.

States are distinct: **Saving locally → Saved on device / waiting to sync → Synced**, or local save/sync attention. Never label an in-memory action Saved before the durable transaction succeeds. If that specific write fails, roll back only its optimistic overlay and retain its draft/retry action. An uncertain write uses the existing store reconciliation guard; do not retry under a fresh identity.

Replace the current global selection-hook in-flight lock with per-task ordered operations. Unrelated rows, navigation, typing and sidebar actions remain usable during persistence. Rapid repeated completion taps need a final-intent/coalescing policy, not ignored taps or parallel stale writes. Bulk edits are one atomic local transaction with per-task remote outcomes and stable command identities, not an awaited task-by-task UI loop.

Background sync, history refresh, permission checks, OCR and AI do not remount the workspace, steal focus or clear scroll/selection/drafts. An account switch cancels optimistic overlays and queued UI dispatch for the old account. Expensive parsing/list processing is bounded and deferred; native I/O stays off the UI thread. Measure tap-to-visible-response on real e-ink hardware, not just React render time.

## Delivery structure

Keep the validated beta.12 integration as the baseline. Prepare three independently reviewable implementation branches, then merge their current heads into `release/workflow-overview-testing` for a beta:

1. **Offline locations/order/bulk engine:** project create/rename/delete; collection rename/delete; parent/container dependency chains; cached recovery/migration; current ordering contract; atomic bulk mutation and per-task intent. Test restart, uncertain replay, remote conflicts, partial acknowledgement, permissions and dependency failures.
2. **Native interaction workspace:** inline composer/context defaults, expanded row quick actions, selection mode, completed footer, dotted separators, simplified chrome and project/collection menus. Share one row/action/picker system across views; preserve capture routing and full-editor navigation.
3. **Launcher and recognition:** isolated native edge button/lifecycle/permission support, deterministic gesture classifier plus replay tests, title-description parser and AI proposal/provenance changes. Launcher acceptance needs hardware input testing; do not bundle gesture guesses into a UI release without it.

Some UI work can proceed against service interfaces while engine support is developed. Avoid rewriting the 1,000-line TaskHome screen in one undifferentiated patch: extract a workspace controller and shared row/picker/action components with explicit states first. Separate real device validations from mocked rendering and deterministic queue tests.

Completion criteria: all requested operations are usable offline where data/permissions permit; queued dependencies survive restart; no global input freeze; no accidental selection completion; ordinary completed reopening and recurring safeguards remain correct; task order matches Todoist; parent deletion never races unsent dependent changes; handwriting title/description proposals preserve edits; launcher does not generate pen strokes or leave overlays after disable. Build/typecheck/lint, inspect JS/native contents inside the package, install only the combined beta, and document any unavailable hardware checks precisely.

## Preview coverage

The conversation prototype exercises inline creation with spaced-dash parsing, row expansion/edit/date/move/order/delete, selection mode, bulk date/move/priority/delete, completed grouping/reopen, project/collection create/rename/delete choices and simplified chrome. It uses fictitious tasks only and never calls Todoist or AI. Its fixed October 2026 date grid is a flow demonstration; the plugin's real calendar must navigate months/years. The actual floating overlay, hardware gestures, durable persistence and network synchronization are implementation work, not simulated completion claims.

Preview source: [design/native-interactions.html](design/native-interactions.html). Browser checks passed for inline row expansion, quick-add dash splitting, two-row selection and collection move with selection retained, launcher return, and date editing. These are preview checks; no device/runtime changes or paid AI requests were made during this design pass.
