# SuperTask

A Todoist integration for Supernote e-ink tablets. Capture handwritten notes as tasks, browse and manage your Todoist account from an e-ink friendly interface, and maintain bidirectional links between your notes and your task list.

The goal is to combine the Supernote and Todoist ecosystems: your handwriting flows into Todoist as actionable tasks, and Todoist tasks link back to the exact note and page where you wrote them. You get the best of analog capture and digital task management without switching devices.

## What you can do

- **Lasso handwriting to create tasks** -- select handwriting with the lasso tool, OCR converts it to text, and it lands in Todoist with a link back to the source page
- **Browse and manage tasks on-device** -- view Today, Upcoming, and Project views in a UI designed for e-ink (high contrast, large tap targets, no animations)
- **Edit, complete, and create tasks** -- full task management without leaving your Supernote
- **Bidirectional linking** -- every captured task links back to the note page it came from, and every marked note links forward to its Todoist task
- **Convert handwriting to text** -- optionally replace your handwriting with clean typed text that stays linked to the task, making it easier to read and reposition on the page
- **Quick capture gestures** -- hold and drag with your finger to select and capture without reaching for the lasso tool
- **Cross-note navigation** -- jump from a task back to the note where you wrote it, even across different notebooks

## Install

1. Download the latest `SuperTask.snplg` from the [Releases](https://github.com/apclark31/supernote-plugin-research/releases) page
2. Connect your Supernote via USB and copy the file to `MyStyle/`
3. On the device: Settings > Apps > Plugins > Install
4. Open any note -- you'll see a SuperTask icon in the sidebar toolbar, and "Add Task" from the "..." lasso bar when you select content

## Setup

SuperTask needs a Todoist API token to connect to your account. You can find your token at [todoist.com/app/settings/integrations/developer](https://todoist.com/app/settings/integrations/developer) (scroll to "API token").

On first launch, SuperTask generates a config file on your device at `MyStyle/SuperTask/supertask-config.json`. There are three ways to enter your token, from easiest to most involved:

### 1. Edit the config file via USB (easiest)

Connect your Supernote to a computer, open `MyStyle/SuperTask/supertask-config.json` in a text editor, and replace `YOUR_TOKEN_HERE` with your actual Todoist API token. Save the file and reopen the plugin. Your plain-text token will be automatically obfuscated the next time the plugin loads -- it's encoded with XOR + base64 so the raw token isn't sitting in a readable file on your device.

### 2. Bluetooth keyboard

Pair a Bluetooth keyboard to your Supernote (Settings > Bluetooth), then open SuperTask's config screen, tap the token field, and paste with Ctrl+V. Tap Save.

### 3. On-screen keyboard

Tap the token field in SuperTask's config screen and type the 40-character token using the Supernote's on-screen keyboard. Slow, but you only need to do it once.

Once entered, tap "Test Connection" to verify everything works. Your token persists across plugin reinstalls since it's stored outside the plugin package.

A help popup with these instructions is also available in the plugin itself -- tap the **?** button next to the token field on the Connections tab.

## Usage

### Opening SuperTask

Tap the **SuperTask icon in the left sidebar toolbar** while viewing any note. This opens the main task home where you can browse, search, and manage your tasks. You can also access settings from here.

### Capture a task from handwriting

1. Write something in a note
2. Use the lasso tool to select it
3. Tap the **"..."** button in the lasso toolbar to reveal additional actions, then tap **"Add Task"**
4. OCR converts your handwriting to text -- edit the title if needed
5. Set priority, project, and due date
6. Tap **"Create"** -- the task appears in Todoist with a reference back to this note and page

After creating a task, you have two options for marking the original handwriting:

- **Keep as handwriting** -- adds a dashed border around your handwriting with a supertask:// link connecting it to the Todoist task. Your original writing stays untouched.
- **Convert to Text** -- replaces your handwriting with clean typed text linked to the task. This is useful if you prefer something easier to read and reposition on the page. The typed text maintains the same Todoist link, so you don't lose the connection.

Either way, the content on your note page is linked to the task in Todoist, and vice versa.

For batch capture syntax, grouping, review behavior and the optional AI privacy controls, see [Batch capture shorthand](docs/batch-capture-shorthand.md). Beta.26 restores bordered text controls for Settings, Close, View and the list menu, keeps the sidebar toggle icon, places the composer destination beside the calendar, and moves Batch actions into the review header. The beta.26 package is built and verified locally. Beta.24 remains the installed device version; beta.25 and beta.26 have not been installed. Keyboard reachability for the deep New AI model ID field and these UI changes remain pending hardware checks; see [TESTING.md](TESTING.md) and [VALIDATION.md](VALIDATION.md).

### Quick capture with finger gesture

If enabled in settings (Preferences > Handwriting), you can hold your finger on the page for 400ms then drag to draw a selection area. This opens the quick-add overlay directly, skipping the lasso tool step.

### Browse and manage tasks

Tap the SuperTask icon in the sidebar to open the task home. Four tabs:

- **Today** -- tasks due today
- **Upcoming** -- tasks with future due dates
- **Projects** -- browse by Todoist project
- **Device** -- tasks captured from this device

A **"This Page"** section at the top shows any tasks linked to the current note page, so you can quickly see what you've already captured.

From any task, you can open its detail view to edit the title, change priority, update the due date, move it to a different project, mark it complete, or delete it.

### Viewing tasks from your notes

Long-press (hold ~800ms) on any content with a supertask:// link to open that task's detail view directly. From there you can see the full task info, any comments you've left in Todoist, and the note context it was captured from.

### Cross-note navigation

From a task's detail view, tap **"View Note"** to navigate back to where you originally captured it.

- **Same note:** the plugin closes and shows a "Go to page N" hint so you know which page to flip to. The SDK doesn't have a `goToPage` API yet, so you navigate there manually.
- **Different note:** a temporary link is placed on your current page that you can tap to jump to the source note. SuperTask automatically removes this link from the previous page the next time you open the plugin, so it doesn't leave clutter behind.

Both cases are workarounds for now -- the Supernote SDK doesn't yet provide direct "open note" or "go to page" APIs. Once those become available, navigation will be seamless without the intermediate steps.

## Configuration

Open SuperTask's settings with the **Settings** button in the plugin header, or from Settings > Apps > Plugins > SuperTask.

### Connections tab
- **API Token** -- your Todoist API token
- **Test Connection** -- verify the token works and see your project count

### Preferences tab
- **Default tab** -- which tab opens first (Today, Upcoming, Projects)
- **After creating a task** -- prompt for next action or go back automatically
- **Show projects** -- filter which Todoist projects appear in the plugin
- **Default project** -- where new tasks go by default
- **Mark as text font size** -- text size for "Convert to Text" output
- **Quick capture gesture** -- enable/disable the finger hold-and-drag gesture
- **Debug mode** -- show diagnostic tools (for development)

## Limitations

- **Requires wifi** for Todoist sync. There is no offline queue yet -- task creation fails without connectivity.
- **OCR quality** depends on handwriting clarity. The on-device recognition works best with clearly separated words.
- **Cross-note navigation** uses temporary link elements as a workaround (see above). This will improve as the SDK adds direct note navigation APIs.
- **Note renames** break task back-references. If you rename a .note file after capturing tasks from it, the "View Note" link won't resolve.
- **No background sync.** The plugin can only sync when its UI is open. Task status changes made in Todoist are fetched on next open.

## Tested devices

- Supernote A5X (10.2" e-ink)

The plugin should work on all Supernote devices that support the plugin system (A5X, A6X2 Nomad, A5X2 Manta), but has only been tested on the A5X.

## Building from source

```bash
cd plugins/SuperTask
export ANDROID_HOME="$HOME/Library/Android/sdk"
bash buildPlugin.sh
# Output: build/outputs/SuperTask.snplg
```

Requires Node.js >= 18, JDK >= 19, Android SDK Platform 35. The build takes ~30s (release with R8 minification) and produces a ~3MB `.snplg` file.

## Architecture

SuperTask is a React Native app running inside Supernote's PluginHost process. It uses the `sn-plugin-lib` SDK to interact with the NOTE app and `react-native-fs` for persistent config storage. Tasks sync via the Todoist REST API (v1).

Key components:
- **Lasso capture + OCR** -- `recognizeElements()` converts selected strokes to text on-device
- **Bidirectional linking** -- supertask:// links in notes point to Todoist tasks; Todoist task descriptions reference the source note and page
- **Task registry** -- local JSON file tracking which tasks were captured from which notes and pages
- **Gesture detector** -- finger long-press and drag gestures for quick capture and task lookup
- **Config persistence** -- JSON file in `MyStyle/SuperTask/` survives plugin reinstalls, with automatic token obfuscation
