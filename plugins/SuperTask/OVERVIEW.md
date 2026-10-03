# Inline project overview

Independent branch `feature/project-overview`, based on original `main` revision `8c64cde400fa872c6bee70779d9cb036c90d5ba7`. This feature can be reviewed separately from `feature/offline-task-workflow`. Combine both for device testing; it does not change storage, authentication, sync or capture behavior.

In **Projects**, tap a project header to expand/collapse its tasks inline. Several projects may stay open. **Expand all** reveals a broad overview; **Collapse all** returns to project names/counts. **Compact / Comfortable** changes row density. View preferences survive navigation during the JS session, without retaining task content or credentials.

The native Supernote Tasks app was inspected read-only on the Nomad before the user took it away. This UI adopts its thin separators, circular selection marks, simple counts and compact rows. It retains SuperTask's select-then-Complete interaction, task details/editing, and an explicit **Open** button for the existing individual project view. Collapsing a project clears only selections it conceals; Collapse all clears concealed visible selections. Font scaling remains available. No animations or nested task-list scrolling are introduced: headers and revealed tasks share one virtualized list.

Project counts exclude completed/deleted/filtered tasks. Queued tasks with no server project yet appear under Inbox when its cached identity is present. Tasks sort by calendar due date, then priority, retaining fetched order for ties. Empty expanded projects show a clear message. Named Todoist sections and nested-subtask organization remain outside this change.

## Verification

Run `node --test tests/overview*.test.cjs`: **7 passed**. Five model cases cover filtered counts, unsynced Inbox placement, ordering, multi-project expansion, empty rows, stable keys and concealed selection cleanup. Two actual React component tests cover independent expansion, task/project actions, density, Expand/Collapse all and selection cleanup with mocked native view primitives. React's existing test renderer emits a deprecation notice; that is not hardware validation.

Changed UI-file ESLint has no errors; style warnings remain. Standalone full TypeScript still reports inherited SDK/global/legacy-screen errors from the original main baseline; no errors occur in the new overview/model/TaskRow/settings code. The offline PR fixes those baseline typing issues, so the **combined** branch must pass full TypeScript before handoff. React Native/React/renderer remain `0.79.2`/`19.0.0`/`19.0.0`; compatible React types are pinned to `19.0.0` rather than left floating.

Device verification of this new UI is **pending** because the user took the Nomad. After installing the combined artifact: expand two projects, verify visible counts/tasks, switch density, select one task and collapse its project (selection must clear), use Open/back and task detail/back, then complete/undo a labeled scratch task offline. Reconnect and confirm queue/overview update together. Confirm readable touch targets, scrolling and e-ink refresh at normal/enlarged font sizes. Do not use unrelated tasks for mutation tests.
