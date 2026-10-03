# Combined workflow and overview testing

Current branch: `release/workflow-overview-testing`. This branch contains both independent feature heads; it is for integration/testing, not a published release. Neither PR is merged into main.

| Feature | Draft PR in user fork | Included source revision |
|---|---|---|
| Offline queue, private settings/cache, batch review and optional AI | [PR 1](https://github.com/ofples/supernote-plugin-research/pull/1) | `4298b22457b60851b30cf008b828a9e0ee7c5cc9` |
| Expandable project overview and native-inspired density | [PR 2](https://github.com/ofples/supernote-plugin-research/pull/2) | `be97009d6973090d0440f0239ea90f77f51285ee` |

Integration merge: `a54d167` (both histories retained, no conflicts). Testing-only package version is `0.4.0-beta.5`, code `10`. Existing plugin ID/key are unchanged. Native host pins and AI lockfile remain intact.

## Current artifact and checks

`C:/Users/pless/Code/Supernote/SuperTask/plugins/SuperTask/build/outputs/SuperTask-combined-beta5.snplg`

7,513,233 bytes. SHA-256: `1fded7b33b3c9db4b7aa78bfaf092305701a434af057a861dc59e08f45f18896`.

- **39 tests passed**: 32 workflow/AI/transport/cache cases plus 7 overview/model/React interaction cases.
- Full TypeScript passed after integration. Changed runtime-file lint has no errors; non-blocking style warnings remain. React's existing test renderer emits its deprecation notice.
- Complete native/JS/package build passed. `verify_package.py` checks identity/icon/config/native classes/ReactPackage registrations/ARM64 libraries and both workflow and overview JS markers.
- Both feature heads are ancestors of the testing branch. Feature worktrees and the testing checkout are clean after commits.
- Inherited 69 dependency advisories remain; this is not an audit-clean release.

The Nomad's last installed package is **beta.4**, verified enabled and starting with its original eight active tasks and zero queue. The user then took the device; no further ADB interaction was performed. **Beta.5 has not been installed or tested on the device.** Workflow hardware evidence is in [VALIDATION.md](VALIDATION.md); overview scope and exact pending UI checks are in [OVERVIEW.md](OVERVIEW.md).

## Keeping this branch current

After either feature PR changes, commit/push its feature branch. From a clean testing checkout run `./plugins/SuperTask/syncTestingBranch.ps1` (add `-Push` to publish the integrated branch). The helper checks branch/cleanliness, fetches the user fork, merges both feature refs without rewriting history and verifies ancestry. It stops on conflicts; resolve and review them explicitly. It neither installs to a device nor publishes releases or merges PRs into main.

Then rerun `npm run test:offline`, full TypeScript, appropriate lint, `buildPlugin.ps1` and `verify_package.py` from the plugin directory. Increase the testing package version/code before a new device install, and update these revisions, results and hash. Preserve prior validated artifacts under distinct ignored filenames. Device installation waits for the user's device availability.

## Next Nomad session

1. Back up affected state and install the full beta.5 package after confirming availability. Verify version, native storage startup and unchanged queued work.
2. Projects → expand two projects, Expand all/Collapse all, switch Compact/Comfortable. Check task counts and rows against cached tasks, including an offline pending Inbox task. Empty projects must explain their state.
3. Select a labeled scratch task then collapse its project: its selection must clear. Open project/back and task detail/back; expansions/density must remain during navigation. Confirm normal/enlarged text, touch targets, scrolling and e-ink refresh.
4. Complete/undo only a labeled scratch task offline, reconnect/open and check the overview updates with queue acknowledgement.
5. Perform the separate handwritten batch, source-link/landscape and optional paid AI checks in VALIDATION.md. Suggested date/priority examples: “water the plants tomorrow” and “P1: call mom today”; inspect structured suggestions before saving. Ambiguous “important” priority interpretation needs human review.

SuperDashboard and Todoist section/subtask hierarchy UI remain deferred/outside this implementation. No unrelated notes/tasks should be changed during validation.
