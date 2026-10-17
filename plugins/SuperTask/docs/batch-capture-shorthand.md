# Batch capture and shorthand

**Planned beta.22 documentation.** The beta.22 package has not been built or verified on a device. Controls and examples below describe the current local implementation and may change after tester feedback.

## Review a batch

Capture from handwriting or open batch entry to review one task per row. The task rows stay in the main screen. Tap **Batch actions** for shared project/collection, date, priority, labels, selection, row addition, and OCR grouping controls. A small summary remains visible beside the toolbar. Row-level edits and overrides stay attached to their row when shared defaults change.

For recognized handwriting, **Lines** keeps separate unbulleted lines as separate tasks and joins indented wrapped lines to the previous line. **Paragraphs** joins wrapped lines within a blank-line block. Explicit bullets start separate tasks. If you insert line breaks and choose **Split**, each non-empty line becomes its own task. Review titles and details before saving; the original handwriting is not changed.

The parser splits a spaced dash (` - `) at its first occurrence into title and description. Other hyphens remain part of the text.

## Optional AI refinement

Device OCR and local saving do not require AI. In Settings, AI refinement is opt-in; **AI by default** is off unless you enable it. When enabled for lasso capture and an API key is configured, AI and device OCR run concurrently. Device OCR remains available when AI fails, times out, or is cancelled. You can also choose **Refine with AI** from batch review.

An AI request sends the selected handwriting image and task details to OpenAI using your API account. Choose a model from the saved model list, add model IDs supported by your account, or remove entries in AI settings. The default model ID is `gpt-4.1-mini`. AI output is a suggestion for review; it does not save tasks on its own.

## Supported shorthand

Shorthand is recognized only when it matches the current, uniquely named project and collection list. Confirmed tokens are removed from the editable title while the original source transcription is retained.

| Meaning | Examples |
|---|---|
| Project | `#Work`, `in Work`, `project: Work` |
| Collection | `#Work /Admin`, `Work /Admin` |
| Collection under the selected project | `/Admin` |
| Label | `%errands`, legacy `@errands` |
| Priority | `p1`, `p2`, `p3`, `p4` |
| Date | `today`, `tomorrow`, `tonight`, `2026-10-18` |
| Local time | `tomorrow at 9:30am`, `2026-10-18 09:30`, `due 2026-10-18 at 09:30` |

Priority numbers map to Todoist priorities in reverse order: `p1` is highest (API priority 4), and `p4` is lowest (API priority 1). Supported local times are kept as floating local date-times rather than converted to UTC.

Multiword names can be written unquoted when they match a known name, or quoted after `#`, for example `#"House Cleaning" /"Weekly Review"`. A project must resolve uniquely; a collection must belong to that project. If names are unknown or ambiguous, leave the text unchanged and choose a destination in review. If project or collection data arrives later, only an unedited row with no manual overrides is safely reparsed.

Email addresses and URL contents are not treated as metadata. Unsupported reminders, assignments, recurrence phrases, deadlines, and conflicting priorities stay in the title for review; the parser does not silently turn a recurring instruction into a one-time date. Legacy `@label` syntax is accepted outside email addresses and explicit assignment/reminder wording.

## Workspace display choices

List or Board layout, grouping (collection, project, date, or none), and sorting (manual, priority, due date, or title) are saved for the current account and view. The Completed section's expanded/collapsed state is saved in that same scope. These are presentation preferences; they do not change task data.

In the inline composer, selecting a project reveals its collections. Tapping a collection or **No collection** applies that destination immediately. Other location pickers may retain their existing staged behavior.

## Gestures and launcher

Quick Add gesture choices are configured in Settings. The optional two-finger bottom-edge gesture and floating launcher are off by default. A 1.5-second pen-contact cooldown suppresses finger gesture activation. Gesture thresholds, launcher permission prompts, rotation and overlay coexistence need beta.22 device verification; see [native interaction validation](native-interactions-validation.md).
