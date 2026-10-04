# SuperTask workflow follow-up goal prompt

Prepared and activated 4 October 2026. This is the preserved execution prompt; the implementation and beta.12 validation handoff are in [FEEDBACK_IMPLEMENTATION.md](FEEDBACK_IMPLEMENTATION.md). The instructions below record the approved session scope and completion criteria.

## Goal objective

Implement the complete approved SuperTask workflow in FEEDBACK_PLAN.md: full durable offline task mutations including recurring occurrence completion and collection creation; batch defaults with individual overrides; concurrent device OCR and optional structured AI capture; native-style sidebar and shared immediate task actions; integrated Settings and useful sync status. Deliver separately reviewable draft PRs in the user fork, a current combined testing branch, a built and inspected beta, all available validation, and an exact handoff for any unavailable device checks. Use Luna for bounded implementation and Sol for orchestration, review and difficult coding.

## Execution instructions

Treat [FEEDBACK_PLAN.md](FEEDBACK_PLAN.md) as the complete product specification and acceptance checklist. Read it fully before changing code. It resolves the user's original feedback and subsequent answers; the following requirements are mandatory:

1. Existing and new tasks can be created, edited, moved, completed, reopened and deleted offline, with durable local state and later duplicate-safe sync. Recurring completion closes the current occurrence, preserves the series, advances it once, survives process death, and does not complete a remotely advanced occurrence accidentally. Collection creation works offline, with dependent task operations waiting safely for its real ID.
2. Actual remote conflicts use the remote task and show a brief notice. Unchanged remote tasks retain local work. Preserve unsent new tasks; reconcile uncertain previously sent commands before judging conflicts. Do not choose newer by comparing device/server clocks, and do not add a conflict-resolution screen.
3. Batch quick date/project/collection/priority/label assignments preserve independent row overrides. New rows inherit current defaults; merge/split/refinement cannot silently erase those overrides. Replace Captured today with working Today, Tomorrow, Custom date and No date. Add Tomorrow to the shared calendar.
4. Lasso capture exposes Refine with AI before native OCR completes, sending the crop immediately when requested. Native OCR continues in the background. AI wins when requested and successful; failure, timeout, Cancel AI or Use device OCR uses the available OCR result. Guard all result/lifecycle races. Keep AI visible across Wi-Fi changes, optional and bounded. Its structured suggestions enter review and never automatically save tasks.
5. AI assigns a known project or collection only when explicitly and unambiguously named. Generic task meaning cannot infer location; unknown names stay unchanged. Preserve manual choices and excluded rows. Keep the existing Vercel AI SDK adapter and private key/model configuration.
6. Replace top tabs with a left sidebar: Today, Tomorrow, Upcoming, Inbox, This Note when applicable, On Device, Done, All projects, then a plain Projects header and a scrolling project list. Sidebar projects do not expand or collapse. Collections appear only in the selected project's main pane. All projects retains the broad expandable overview in its main pane.
7. All list views share task-row design and mutation behavior: checkbox immediately completes, task body opens details, and source-note links remain available. This Note is a separate view. Replace primary Pending navigation with row sync symbols and a tappable summary exposing all queued changes/errors, including deleted tasks and collections.
8. Use compact project buttons and selected-project collection choices in forms. Hide empty collection headings, offer inline New collection, and preserve valid location relationships. Integrate AI fields into main Settings with a dismissible initial setup hint. Fix project visibility semantics and migrate existing preferences consistently.
9. Honor Ask / Go back after single or batch creation. Ask shows the created tasks as an editable list with Done and Add another. Go back returns to the source note or originating task view. Saved locally must not be reported as acknowledged by Todoist.
10. Show useful offline/reachability status and queued-work counts; retain distinct authentication, permission and rate-limit messages. UI changes appear after local durable commit, without waiting for the network; failed local saves remain visible errors.

## Workspace and Git

Work in `C:/Users/pless/Code/Supernote/SuperTask`, plugin `plugins/SuperTask`, using the fork `ofples/supernote-plugin-research`. The preparation baseline is `release/workflow-overview-testing` at `97a4e8f3879662bf92f7b731dc8c6a036c365b92`; subsequent documentation-only preparation commits do not change its runtime. At session start, verify clean state, fetch the user fork, record the actual integration HEAD and freeze a comparison baseline for follow-up PRs.

Preserve the existing three draft PRs and their fixed comparison bases. Prepare focused follow-up branches/PRs for (a) offline/recurrence/collections/conflicts, (b) capture/batch/AI/forms, and (c) sidebar/list actions/settings visibility. Dependent PRs should target the proper fixed or feature comparison base so reviewers see only the intended change. Merge feature heads into the existing testing branch, update its maintenance helper, and verify ancestry. Attach every created PR to this chat. Do not merge main, publish a release, force-push, rewrite existing history or use the upstream maintainer's Jira.

Use the configured local author Ofer Plesser <plesserofer@gmail.com>. Keep licenses/upstream attribution. Keep third-party reference clones unchanged. Commit cohesive validated milestones, and leave clean checkouts. Use managed worktrees where useful; preserve changes before cleanup. The user has authorized subagents for this implementation, not unrelated new sidebar chats.

## Agent allocation

Use the available collaboration subagents; do not create separate user-owned chats for subtasks. The requested models are available in this session's tool catalog as `gpt-6-luna` and `gpt-6.1-sol`. Recheck availability at activation and do not silently replace Luna with a more expensive model if unavailable.

| Owner | Suitable work |
|---|---|
| Sol orchestrator | Scope/dependency management, shared contracts, architecture, integration, validation, commits/PRs and device control. |
| Luna implementation agents | Bounded calendar/date controls, project/collection picker presentation, Settings embedding/setup dismissal, sidebar presentation, row sync icons, post-create UI, documentation and deterministic tests against an established contract. |
| Sol coding/review | Store migration, synchronization/outbox ordering, uncertain retry/acknowledgement, conflict detection, recurring occurrence semantics, AI/OCR concurrency, native/lifecycle code, and difficult integration fixes. Review every Luna patch before integration. |

Give each Luna assignment a concrete scope, exact owned files/worktree, dependency contracts, acceptance checks and relevant instruction/spec paths. Model-overridden subagents should start with minimal context (`fork_turns: none`) and an explicit self-contained task, rather than duplicating the entire conversation. Start Luna at medium reasoning for ordinary coding; use Sol at appropriate higher reasoning for difficult code/review. Use no more than the session's available concurrency slots, and parallelize only independent tasks after their contracts are stable.

Be efficient: group related bounded changes into cohesive assignments rather than spawning an agent per trivial edit. Pass only necessary files/spec sections and concise findings. Avoid redundant repository exploration, unchanged-status polling and broad test reruns after checks pass unless new changes or unresolved failures justify them. Use targeted checks during implementation and one full combined validation at integration. Do not add a token budget the user did not specify, or treat the authorized AI-request ceiling as a target.

Do not allow concurrent edits to the same files or branch switching under another agent. The orchestrator owns integration, staging, commits, publishing PRs and device actions. Agents return patches, validation and unresolved concerns without committing another agent's work. If a Luna task repeatedly fails, is underspecified or reveals a synchronization/native risk, clarify its contract or escalate that part to Sol rather than looping blindly. Review correctness, accessibility, migration compatibility and tests before accepting a patch.

This allocation follows the user's cost preference. [OpenAI's model guidance](https://developers.openai.com/api/docs/models) describes Luna for focused work and Sol for more complex work; it does not establish this account's exact billing or quota consumption. Track actual delegated work instead of promising a savings percentage.

## Development and verification

Read workspace AGENTS instructions, `plugin-development/README.md`, applicable repository instructions and `C:/Users/pless/.codex/skills/supernote-plugin-dev/SKILL.md` with relevant references. Use live official supernote-docs MCP for SDK signatures and cross-check installed sn-plugin-lib 0.1.65. Read current official Todoist recurrence/Sync arguments before implementing them. Preserve React Native 0.79.2, React/renderer/types 19.0.0, npm lockfiles and existing private storage; reuse installed Android/JDK tooling. Do not add an incompatible SDK/runtime update to this work.

Run the meaningful deterministic acceptance cases in FEEDBACK_PLAN.md, including failed writes, restart during sending, lost responses, partial acknowledgements, conflict preflight, recurring delayed/repeated completion, collection dependency mappings, per-field overrides, calendar boundaries and OCR/AI race permutations. Use the real installed AI SDK parsing tests plus component interaction tests. Run full relevant tests, TypeScript, lint errors, the complete native/JS build and archive/native verification. Do not call a skipped, failed or hardware-pending check passed.

Increase the beta version/code for changed runtime, preserve prior packages under ignored distinct names, verify actual identity/icon/permissions/native classes/registrations/ARM64 content, and record the final package's path and SHA-256. Review the combined branch against the specification, not only individual patches.

The Nomad's last verified build is beta.8, enabled, with successful private startup and overview header rules. It may be disconnected; query current availability once before device work. The user authorizes plugin installation and scratch device verification for this workflow when available. Back up what is accessible, verify the selected serial/version, and never clear PluginHost data or use destructive recovery. If the user takes the device, stop device interaction and continue useful local work.

Device unavailability must never cause idle waiting or repeated ADB polling. Continue all independent coding, Sol review, automated verification, Git/PR integration and packaging. Write the exact outstanding test steps, expected outcomes, package version/hash and any scratch cleanup into the handoff. Retry device access when the user reports reconnection or a necessary later device step gives a reason to check; keep unavailable hardware checks explicitly pending.

The user authorizes **up to 100 paid AI requests** using SuperTask's configured key for small scratch verification. This is a maximum, not a target; use only justified calls and record their number. Send no real notes, print no keys, keep provider bodies/task content out of diagnostics, and do not make paid requests merely to probe connectivity. Do not change the configured AI model/key for convenience.

Clean up only known labeled scratch data, including `Codex-collections-scratch-20261004-A`, and new labeled test tasks/collections/notes created by this session. Preserve user changes and restore Wi-Fi or temporary preferences changed during testing. Existing private screenshots/task data and all generated artifacts remain ignored.

## Completion and handoff

Carry the activated goal through the entire approved scope, review, clean commits, draft PRs, combined testing branch and beta packaging. Do not stop after a foundation milestone or after agents finish their individual assignments.

Completion requires every feature implemented, Sol review concerns resolved, meaningful automated checks passed, the combined package built/inspected, and all available device checks performed. Disconnected hardware or absent credentials may be deferred under the user's established policy; they must have a precise checklist, current evidence and an honest limitation, and must not excuse unfinished local implementation. Record the resulting behavior, branch/PR identities, exact integrated revisions, package/version/hash, passed checks, actual AI request count, remaining scratch data and any deferred verification in PROGRESS.md, TESTING.md and relevant feature documentation. Report any unsupported behavior instead of silently shrinking scope.

When the user starts this unattended session, activate a goal using the Goal objective above without inventing a token budget, then execute this prompt and FEEDBACK_PLAN.md. Do not activate it merely because this preparation document exists.
