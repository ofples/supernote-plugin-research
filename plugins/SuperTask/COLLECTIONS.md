# Project collections (Todoist sections)

Collections are Todoist's named sections inside a project. SuperTask uses the existing section IDs and names; it does not create or rename sections.

## Behavior

- Expanding a project in Projects reveals its collections and their tasks, with project totals. The individual project view groups by collection and provides **+ Task** for each collection. Empty collections remain visible; tasks without a section appear under **No collection**. Unknown/deleted sections are shown as unavailable rather than silently reassigned.
- New task, Edit Task, each batch row's Details, and default task settings share an inline project/collection picker. Selecting a project reveals only that project's collections. Changing projects clears the old collection. Existing task sections survive unrelated edits.
- Today, Upcoming, Done, On Device, This Note and Pending task metadata includes the collection when available. Cached sections remain usable offline and after process restart. A full sync must include items, projects and sections before replacing the snapshot.
- Local unsent task creation/editing stores `section_id` in the durable queue. After a send begins, the command's section and identity remain frozen through retries. Editing/moving tasks already on Todoist requires an online connection, matching the existing edit workflow.
- Optional AI refinement receives known projects/collections and returns a required nullable `sectionId`. Local validation rejects invented, archived or cross-project section IDs; suggestions remain editable before saving. No paid AI call was performed for this change.
- Collection rules span the full list width in the overview and project view. Text and action buttons sit inside the ruled row. This final visual change awaits device inspection.

Todoist's [current API reference](https://developer.todoist.com/api/v1/) defines sections and a separate task-move operation. Location changes use `/tasks/{id}/move`, with a section destination or explicit project destination for No collection. Detail updates and moves are separate requests; if a move fails after details were accepted, the UI reports partial success and requests a refresh.

## Branches and checks

Feature: `feature/project-collections`. Comparison base: `review/workflow-overview-base` at `b60df9d5685730f38813ba13326ceaa25f9cf46b`. The fixed comparison base contains the previously integrated offline and overview work, so the collections PR isolates this extension. The combined testing branch retains all feature histories. No PR is merged into main and no release is published.

- **51 tests passed**, including old-store compatibility, active/unknown collection grouping/order, frozen section IDs, project changes, strict AI section validation, React picker/batch interactions, online move/partial-success behavior, acknowledged local task identities and incomplete snapshot protection.
- Full TypeScript and changed runtime-file lint passed without errors. Existing style warnings and inherited dependency advisories remain.
- Full native/JS package build passed. The Windows build waits for the Gradle command itself instead of waiting indefinitely for its daemon. Package inspection verifies identity, icon, permissions, JS collection/workflow/overview markers, native classes, registrations and ARM64-only library content.

Final build: **0.4.0-beta.8**, code **13**, same plugin ID/key.

`build/outputs/SuperTask-collections-beta8.snplg` — 7,516,264 bytes.

SHA-256: `d2863a59a7f5a689e8018741692287185ba1261357fe6d12d0441710cffba5f2`.

## Nomad evidence — 4 October 2026

Firmware: `Chauvet.E103.2609111001.2505_beta`. Device: `SN078D10010594`.

1. Installed beta.5/code 10 via explicit package selection, verified enabled and opened with **nine existing active tasks and zero queued changes**. Inline expansion/collapse and density switching worked.
2. Installed beta.6/code 11 and verified its actual version, native/private startup and sync. House's existing Cleaning, Maintenance and Shopping collections appeared under the project and in task forms.
3. Turned Wi-Fi off. Created only `Codex-collections-scratch-20261004-A` in House/Shopping, then changed the unsent task to Maintenance. Pending showed the correct collection and one queued task.
4. Closed/restarted PluginHost non-destructively while offline; the same task, Maintenance choice and queue survived. Re-enabled Wi-Fi, refreshed, and verified the task under House/Maintenance with no pending marker.
5. Moved that scratch task online to Cleaning, then to **No collection**, and verified the corresponding project groups. Original task/collection contents were not edited. An inadvertent Settings default-tab tap was restored to Last opened.
6. The user took the Nomad before final installation/cleanup. ADB work stopped immediately. **The device's installed version remains beta.6**. Beta.7 was copied to MyStyle but never installed. Beta.8 is built locally and not uploaded/installed. No host data clearing/uninstallation/recovery was performed.

**Remaining scratch data:** `Codex-collections-scratch-20261004-A` in House → No collection. Last observed account total: ten active tasks (nine original plus this test task), zero queued work. Wi-Fi was restored ON. Device/package backups and UI dumps are ignored private files; the package backup does not constitute a backup of private app storage.

## Next device session

1. Confirm device availability, copy beta.8 and explicitly select/install that file. Do not reinstall the managed beta.6 copy or install the previously staged beta.7 file. Verify beta.8/code 13 and preserved queue/settings.
2. Inspect full-width rules in Projects and House, scrolling and enlarged text. Check **+ Task** prefills its collection; check batch Details, per-row collection selection, manual Add row defaults, and atomic batch sync with differently assigned sections.
3. Delete only the named scratch task above and any newly labeled test tasks. Refresh Todoist and confirm the original task count/current user changes and zero queue. Preserve user-added tasks.
4. The earlier handwriting crop/source-note navigation and paid AI checks in VALIDATION.md remain pending. Structured SDK parsing is covered by local tests, not a live paid request.

SuperDashboard remains deferred. Subtask hierarchy and section-management actions are outside this extension.
