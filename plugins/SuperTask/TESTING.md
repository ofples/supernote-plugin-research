# Combined SuperTask testing

Current branch: `release/workflow-overview-testing`. This is an integration/testing branch, not a published release. All three feature histories are included; no PR is merged into main.

| Feature | Draft PR in user fork | Included source revision |
|---|---|---|
| Offline queue, private settings/cache, batch review and optional AI | [PR 1](https://github.com/ofples/supernote-plugin-research/pull/1) | `4298b22457b60851b30cf008b828a9e0ee7c5cc9` |
| Expandable project overview and native-inspired density | [PR 2](https://github.com/ofples/supernote-plugin-research/pull/2) | `be97009d6973090d0440f0239ea90f77f51285ee` |
| Project collections across cache, overview, task forms and structured AI | [PR 3](https://github.com/ofples/supernote-plugin-research/pull/3) | `a02e5ee2de5b303bab628a570a2652ef90f06c85` |

Original integration: `a54d167`. Collections integration: `c8b5ca559f173bc3237da42432e2072176dfc9d3`. Histories were retained without conflicts. Collections PR uses the fixed `review/workflow-overview-base` comparison branch at `b60df9d` to isolate its diff from the earlier two PRs.

## Current artifact and checks

Testing package: **0.4.0-beta.8**, code **13**, with the user's full-width collection-header correction. Existing plugin ID/key, native host pins and lockfile are unchanged.

`C:/Users/pless/Code/Supernote/SuperTask/plugins/SuperTask/build/outputs/SuperTask-collections-beta8.snplg`

7,516,264 bytes. SHA-256: `d2863a59a7f5a689e8018741692287185ba1261357fe6d12d0441710cffba5f2`.

- **51 tests passed**: the previous 39 workflow/AI/cache/transport/overview tests plus 12 collection cases.
- Full TypeScript and changed runtime-file lint have no errors. Non-blocking style warnings and the existing test-renderer deprecation notice remain.
- Complete native/JS build and `verify_package.py` passed, including identity/icon/permissions, collection/workflow/overview JS markers, actual nested native classes/registrations and ARM64-only library content.
- The testing branch's runtime source matches the validated collections feature head; integration changed no runtime code. All three heads are ancestors of this branch.
- Inherited 69 dependency advisories remain. This is not an audit-clean release.

The Nomad's installed package is **beta.8/code 13**. Plugin Manager verified Version 0.4.0-beta.8 and enabled ON on 4 October. Private settings/cache startup survived a non-destructive host restart. The full-width collection rules in Projects were visually verified on hardware. Beta.6 previously proved collection display, offline task create/edit with collection selection, restart retention, sync into the selected collection, online move and clearing to No collection. ADB disconnected before dedicated project-view, batch/default/large-text checks or scratch cleanup. Beta.7 was never installed.

**One scratch task remains:** `Codex-collections-scratch-20261004-A` in House → No collection. Last observed total was ten active tasks, including the nine pre-existing tasks; zero queued changes. Wi-Fi is ON. Remove only the labeled test task when the device returns, preserving any new user work. Details and the precise pending checks are in [COLLECTIONS.md](COLLECTIONS.md).

## Keeping this branch current

After a feature changes, commit/push its feature branch. From a clean testing checkout run `./plugins/SuperTask/syncTestingBranch.ps1` (add `-Push` to publish the integration branch). The helper checks branch/cleanliness, fetches the user fork, merges **all three** feature refs without rewriting history and verifies each head's ancestry. It stops on conflicts. It does not install to a device, publish a release or merge PRs into main. Keep the collections comparison base fixed so its PR remains reviewable.

When runtime code changes, run the appropriate tests, TypeScript, lint, full build and package verifier. Increase the package version/code before another device installation and update this hash/results. Preserve prior validated artifacts under distinct ignored filenames. Documentation-only updates do not require rebuilding the unchanged runtime.

## Next Nomad session

1. Confirm availability and the installed beta.8 version; installation/enabled/startup/overview-rule checks have already passed.
2. Inspect full-width rules in the dedicated project view, enlarged text, scrolling and + Task defaults. Exercise batch Details with different collections, Add row defaults, and atomic batch sync. Clean up the named scratch task and any newly labeled test tasks.
3. The earlier handwritten batch/crop/source navigation and optional paid AI checks remain pending in [VALIDATION.md](VALIDATION.md). Do not treat local structured-SDK tests as a live paid AI verification.

SuperDashboard remains deferred. No unrelated notes/tasks should be changed during validation. Section creation/renaming/deletion, subtask hierarchy and recurring offline changes are outside the installed beta.8 extension. The user's next-session feedback, including offline collection creation, is prepared separately in [FEEDBACK_PLAN.md](FEEDBACK_PLAN.md); that implementation has not started.
