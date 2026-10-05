# Optional launcher and strict edge swipe

Implemented locally on 5 October 2026. Default settings remain off. This is a
finger-only launcher; hardware acceptance is pending the combined-beta test.

## Launcher

`TaskLauncherModule` is registered by the existing `NoteOpenerPackage` entry in
PluginConfig's reactPackages. The native window is exactly 48 dp square, white
with a black outline, non-focusable and non-modal. It never creates a transparent
full-screen touch surface. A tap opens the SDK plugin view once, natively, so it
can wake React while JavaScript timers are suspended. The JS event routes to the
configured default task view. Dragging, a cancelled gesture, an extra contact,
stylus input, a long hold, or a displaced release cannot open tasks.

Dragging snaps to the nearer left/right edge and persists the vertical fraction
of available screen height through the private config save queue. Rotation reads
real physical display metrics and reapplies the same edge/fraction. A failed
position save restores the last durable setting. Settings offers enable/disable,
edge choice, reset position, and a just-in-time permission screen for PluginHost.

Visibility uses native `UsageStatsManager.queryEvents`, checked at most once per
three seconds only while enabled, screen on and the SuperTask UI closed. It
requires existing host usage permission; missing permission or ambiguous results
hide the window. No shell/dumpsys subprocess is spawned. The initial bounded
24-hour query establishes the current foreground package; later queries only
read new events. A fresh query also gates every tap. NOTE/DOC packages are allowed;
other apps hide the launcher within one monitor interval. Host internal panels
which share an Activity cannot be distinguished from its note canvas by package
usage events. Other plugins' overlays are never removed or reconfigured.

Our UI open/close marks and SDK lifecycle events suppress/restart the overlay;
unmount/destroy/disable removes it. Screen-off removes it and stops monitoring.
Invalidation releases the listener, receiver and worker. A private native owner
token prevents older plugin classloaders from recreating overlays or clearing a
new owner's overlay; orphan inspection only targets SuperTask's unique tag.

## Pen limitation

The button consumes Android stylus events but does **not** claim to protect the
underlying note. Supernote has an independent hardware ink path that bypasses
WindowManager overlays. The current public SDK provides no scoped pen-exclusion
rectangle. The community reference also reports that PluginHost's SELinux domain
cannot access drawpath's selective rectangle service. Replacing a global rect
list would interfere with NOTE and other plugins even if accessible.

This implementation therefore reports `scopedPenProtection: false`, discloses the
limitation in Settings, and never calls full-screen pen-disable/state APIs. Use a
finger and position the button outside writing. Precise pen safety is a platform
limitation, not a passed check; synthetic scratch-note pen-under-button testing
must record whether ink appears and confirm writing elsewhere remains available.

## Strict swipe

The existing optional bezel setting now requires exactly three stable finger
pointer IDs starting within the bottom 4% of known native screen dimensions.
Contacts assemble within 250 ms, stay separated and move coherently upward at
least 150 physical pixels while all three remain down. At least three move samples
and 300 ms are required; the whole stream must fit within 3500 ms. Per-contact
drift, jumps, reversal, uneven displacement, extra/unknown tools, mismatched counts,
ID replacement, cancellation, early/slow release and reentry fail closed. Every
contact must qualify before release; only the final UP can launch once. Pen
activity establishes a 1500 ms cooldown and successful launch a 1800 ms cooldown.
There is no relaxed two-finger path, max-observed-Y calibration or mid-page recovery.
The existing native lasso/long-press routes are preserved. Device traces remain
necessary to tune activation; rejecting a deliberate swipe is safer than a palm
false positive.

## Validation and remaining hardware checks

- Eight focused Node tests cover coherent reordered pointer identities, physical
  dimensions/rotation, palm/pen/extra contacts, cancellation, drift/jumps, pen and
  launch cooldowns, malformed events, blocked streams, early lifts and slow release.
- TypeScript and focused ESLint checks pass with no errors. Existing style warnings
  remain in legacy touched files.
- Release Kotlin compilation and Metro/Hermes bundling passed locally; the root
  integration must rebuild/inspect the actual `.snplg` with this native class.
- Read-only Nomad diagnostics found PluginHost `SYSTEM_ALERT_WINDOW` and
  `PACKAGE_USAGE_STATS` granted. GET_USAGE_STATS app-op reports default mode;
  runtime use of granted privileged permission still needs device verification.
- No device installation, note modification, UI interaction, recovery or paid AI
  was performed by this implementation subtask.
- Pending: permission denied/return, tap vs slow tap/drag/cancel, physical edge
  position and rotation, hide/disable, plugin/host restart and classloader cleanup,
  foreground transitions/coexistence, e-ink redraw, idle-monitor overhead, pen under
  the button/elsewhere, deliberate swipe traces and palm rejection on the Nomad.

## Sources and attribution

- Live official [MotionEvent](https://docs.supernote.com/en/api-reference/supernote-plugin/types/motion-event),
  [motion listener](https://docs.supernote.com/en/api-reference/supernote-plugin/plugin-manager/register-motion-listener)
  and [lifecycle states](https://docs.supernote.com/en/api-reference/supernote-plugin/plugin-manager/register-plugin-life-listener).
  Cross-checked against the installed sn-plugin-lib 0.1.65 sources.
- Android [UsageStatsManager](https://developer.android.com/reference/android/app/usage/UsageStatsManager)
  and [UsageEvents.Event](https://developer.android.com/reference/android/app/usage/UsageEvents.Event).
- Installed Supernote plugin skill floating-window/pen-emr references; scoped
  pen-service limitations are community findings, not a public supported API.
- Overlay flags and targeted orphan cleanup adapted from AgP42's SuperDashboard
  `DashboardNativeModule.java` (MIT); its checkout was read only and remains unchanged.
