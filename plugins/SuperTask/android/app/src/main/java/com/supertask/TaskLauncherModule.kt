package com.supertask

import android.content.Context
import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Intent
import android.content.BroadcastReceiver
import android.content.IntentFilter
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.util.DisplayMetrics
import android.util.Log
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.UUID
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * A finger-only, tightly bounded launcher; it never changes the device pen lock.
 * Android overlays cannot block Supernote's independent hardware ink pipeline.
 * Therefore scopedPenProtection is explicitly false, rather than pretending that
 * consuming stylus MotionEvents protects the note. No shared disable-rect list is
 * overwritten and no other plugin's windows are removed.
 *
 * Overlay flags / tagged orphan cleanup are adapted from AgP42's SuperDashboard
 * DashboardNativeModule (MIT). Drawing, edge persistence and lifecycle are local.
 */
class TaskLauncherModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context), LifecycleEventListener {
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private var enabled = false
    private var suspended = true
    @Volatile private var disposed = false
    private var polling = false
    private var generation = 0
    private var edge = "right"
    private var fraction = 0.45
    private var window: View? = null
    private var params: WindowManager.LayoutParams? = null
    private var menuWindow: View? = null
    private val dismissMenu = Runnable { removeMenu() }
    private var removing = false
    private var launching = false
    private var lastTap = 0L
    private var usageSince = 0L
    private var foregroundPackage: String? = null
    private val runtimePackage = context.packageManager.getPackagesForUid(android.os.Process.myUid())
        ?.firstOrNull { it == "com.ratta.supernote.pluginhost" } ?: context.packageName
    // PluginHost can load a replacement classloader before invalidating the old
    // module. A process-wide preferences token retires even invisible old owners.
    private val ownership = context.getSharedPreferences("SuperTaskLauncherOwnership", Context.MODE_PRIVATE)
    private val ownerToken = UUID.randomUUID().toString()
    private fun ownsLauncher() = ownership.getString("owner", null) == ownerToken
    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context?, intent: Intent?) {
            main.post {
                generation++
                launching = false
                if (intent?.action == Intent.ACTION_SCREEN_OFF) { main.removeCallbacks(poll); removeWindow() }
                else schedule()
            }
        }
    }
    private val tag = "SuperTask.edgeLauncher.v1"

    init {
        ownership.edit().putString("owner", ownerToken).apply()
        context.addLifecycleEventListener(this)
        val filter = IntentFilter().apply { addAction(Intent.ACTION_SCREEN_OFF); addAction(Intent.ACTION_SCREEN_ON) }
        if (Build.VERSION.SDK_INT >= 33) context.registerReceiver(screenReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        else context.registerReceiver(screenReceiver, filter)
        main.post { clearOrphans(); Log.i("TaskLauncher", "Finger-only launcher ready; scoped pen protection unavailable") }
    }
    override fun getName() = "TaskLauncher"
    private fun dp(value: Int) = (value * context.resources.displayMetrics.density).roundToInt()
    private fun metrics(): DisplayMetrics = DisplayMetrics().also { wm.defaultDisplay.getRealMetrics(it) }
    private fun emit(name: String, value: WritableMap = Arguments.createMap()) {
        if (context.hasActiveReactInstance()) context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(name, value)
    }
    @ReactMethod fun addListener(name: String) {}
    @ReactMethod fun removeListeners(count: Int) {}

    @ReactMethod fun getStatus(promise: Promise) = main.post {
      try {
        val m = metrics()
        promise.resolve(Arguments.createMap().apply {
            putBoolean("permission", Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(context))
            putBoolean("visible", window != null)
            putBoolean("scopedPenProtection", false)
            putBoolean("foregroundDetection", usageAccessAvailable())
            putBoolean("hidePending", ownership.getBoolean("hidePending", false))
            putDouble("width", m.widthPixels.toDouble()); putDouble("height", m.heightPixels.toDouble())
        })
      } catch (e: Exception) { promise.reject("LAUNCHER_STATUS", e) }
    }.let { Unit }

    @ReactMethod fun requestPermission(promise: Promise) = main.post {
        try {
            if (Build.VERSION.SDK_INT >= 23 && !Settings.canDrawOverlays(context)) {
                // The permission belongs to PluginHost, not the plugin APK.
                context.startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:$runtimePackage")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            promise.resolve(true)
        } catch (e: Exception) { promise.reject("LAUNCHER_PERMISSION", e) }
    }.let { Unit }

    @ReactMethod fun configure(on: Boolean, side: String, position: Double, promise: Promise) = main.post {
        enabled = on && !disposed && ownsLauncher() && !ownership.getBoolean("hidePending", false)
        edge = if (side == "left") "left" else "right"
        fraction = if (position.isFinite()) position.coerceIn(0.0, 1.0) else 0.45
        generation++
        launching = false
        if (!enabled) { main.removeCallbacks(poll); removeWindow(); clearOrphans() }
        else { place(); schedule() }
        promise.resolve(true)
    }.let { Unit }

    // JS calls this only after the user's enabled/disabled preference commits to
    // private config storage. Until then the native pending marker wins, including
    // host restart/paused React, so Hide cannot silently reappear.
    @ReactMethod fun confirmHide(promise: Promise) = main.post {
        if (ownsLauncher()) ownership.edit().remove("hidePending").apply()
        promise.resolve(true)
    }.let { Unit }

    @ReactMethod fun setViewOpen(open: Boolean) = main.post {
        suspended = open
        launching = false
        generation++
        if (open) removeWindow() else schedule()
    }.let { Unit }

    @ReactMethod fun stop() = main.post { enabled = false; generation++; main.removeCallbacks(poll); removeWindow(); clearOrphans() }.let { Unit }

    // Cheap native usage events continue while React timers are suspended. Never
    // spawn dumpsys processes or request broad usage access from the user.
    // PluginHost already has it on the validated Nomad; otherwise fail closed.
    private val poll = Runnable { checkForeground() }
    private fun screenOn() = (context.getSystemService(Context.POWER_SERVICE) as PowerManager).isInteractive
    private fun usageAccessAvailable(): Boolean {
      try {
        val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val mode = appOps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, android.os.Process.myUid(), runtimePackage)
        return mode == AppOpsManager.MODE_ALLOWED || (mode == AppOpsManager.MODE_DEFAULT &&
            context.checkCallingOrSelfPermission("android.permission.PACKAGE_USAGE_STATS") == android.content.pm.PackageManager.PERMISSION_GRANTED)
      } catch (_: Exception) { return false }
    }
    private fun schedule() {
        main.removeCallbacks(poll)
        if (enabled && !disposed && ownsLauncher() && !suspended && !launching && screenOn()) main.post(poll)
    }
    // Called only on the serial worker, both by the monitor and just before tap
    // activation. Checking again on tap prevents a stale visible button from
    // opening tasks over an application switched to between monitor ticks.
    private fun readForeground(): Boolean {
        if (!usageAccessAvailable()) return false
        val now = System.currentTimeMillis()
        val since = if (usageSince == 0L || usageSince > now) now - 24 * 60 * 60 * 1000 else usageSince
        val events = (context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager).queryEvents(since, now) ?: return false
        val event = UsageEvents.Event()
        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            if (event.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND) foregroundPackage = event.packageName
            if (event.eventType == UsageEvents.Event.MOVE_TO_BACKGROUND && foregroundPackage == event.packageName) foregroundPackage = null
        }
        usageSince = now
        return foregroundPackage == "com.ratta.supernote.note" || foregroundPackage == "com.supernote.document"
    }
    private fun checkForeground() {
        if (!enabled || disposed || !ownsLauncher() || suspended || launching || polling) return
        polling = true
        val token = generation
        val submitted = submitWork {
            var foreground = false
            try {
                foreground = readForeground()
            } catch (_: Exception) { /* Fail closed: do not cover another application. */ }
            main.post {
                polling = false
                if (token == generation && enabled && !disposed && ownsLauncher() && !suspended && !launching) {
                    if (foreground && screenOn() && (Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(context))) showWindow() else removeWindow()
                }
                if (enabled && !disposed && ownsLauncher() && !suspended && !launching && screenOn()) main.postDelayed(poll, 3000)
            }
        }
        if (!submitted) polling = false
    }

    // Invalidation can shut down the worker concurrently with a main-thread tap
    // or monitor callback. Rejected submission must never escape into PluginHost.
    private fun submitWork(action: () -> Unit): Boolean {
        if (disposed || worker.isShutdown) return false
        return try { worker.execute(action); true } catch (_: RejectedExecutionException) { false }
    }

    private fun showWindow() {
        if (window != null) { place(); return }
        try {
            clearOrphans()
            val panel = object : View(context) {
                private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
                override fun onDraw(canvas: Canvas) {
                    super.onDraw(canvas)
                    canvas.drawColor(Color.WHITE)
                    paint.color = Color.BLACK; paint.style = Paint.Style.STROKE; paint.strokeWidth = dp(1).toFloat()
                    canvas.drawRect(1f, 1f, width - 1f, height - 1f, paint)
                    val unit = width / 8f
                    for (row in 2..5) {
                        canvas.drawRect(unit * 1.5f, unit * row, unit * 2.5f, unit * (row + 0.55f), paint)
                        canvas.drawLine(unit * 3.5f, unit * (row + 0.25f), unit * 6.5f, unit * (row + 0.25f), paint)
                    }
                }
            }
            panel.tag = tag; panel.contentDescription = "Open SuperTask. Drag to move. Hold for Hide and Settings."
            panel.isClickable = true
            panel.setOnClickListener { if (menuWindow != null) removeMenu() else launch() }
            panel.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
                override fun onViewAttachedToWindow(v: View) {}
                override fun onViewDetachedFromWindow(v: View) {
                    // A new plugin classloader removed an old tagged view: retire its
                    // timer as well, so it cannot respawn a duplicate/orphan overlay.
                    if (!removing && window === v) { enabled = false; generation++; main.removeCallbacks(poll); window = null; params = null }
                }
            })
            val size = dp(48)
            params = WindowManager.LayoutParams(size, size,
                if (Build.VERSION.SDK_INT >= 26) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY else WindowManager.LayoutParams.TYPE_PHONE,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
                PixelFormat.TRANSLUCENT).apply { gravity = Gravity.TOP or Gravity.LEFT; title = tag }
            window = panel; place(false)
            installTouch(panel)
            wm.addView(panel, params)
            panel.invalidate() // local e-ink repaint; no global refresh-mode changes
        } catch (e: Exception) { removeWindow(); Log.w("TaskLauncher", "Overlay unavailable", e); emit("SuperTaskLauncherError", Arguments.createMap().apply { putString("message", e.message) }) }
    }

    private fun place(update: Boolean = true) {
        val p = params ?: return
        val v = window ?: return
        val m = metrics()
        val oldX = p.x; val oldY = p.y
        p.x = if (edge == "left") 0 else max(0, m.widthPixels - p.width)
        p.y = (fraction * max(0, m.heightPixels - p.height)).roundToInt()
        if (oldX != p.x || oldY != p.y) removeMenu()
        if (update && v.isAttachedToWindow) try { wm.updateViewLayout(v, p); v.invalidate() } catch (_: Exception) { removeWindow() }
    }

    private fun installTouch(panel: View) {
        var pointer = -1; var startX = 0f; var startY = 0f; var originX = 0; var originY = 0
        var downAt = 0L; var dragging = false; var cancelled = false; var held = false
        val hold = Runnable {
            if (pointer >= 0 && !dragging && !cancelled && panel.isAttachedToWindow && ownsLauncher() && enabled && !suspended) {
                held = true; showMenu()
            }
        }
        val slop = ViewConfiguration.get(context).scaledTouchSlop
        panel.setOnTouchListener { v, e ->
            if (e.pointerCount != 1 || e.getToolType(0) != MotionEvent.TOOL_TYPE_FINGER) {
                cancelled = true; main.removeCallbacks(hold); removeMenu(); return@setOnTouchListener true
            }
            val p = params ?: return@setOnTouchListener true
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    pointer = e.getPointerId(0); startX = e.rawX; startY = e.rawY
                    originX = p.x; originY = p.y; downAt = e.eventTime; dragging = false; cancelled = false
                    held = false; main.removeCallbacks(hold); main.postDelayed(hold, 800)
                }
                MotionEvent.ACTION_MOVE -> {
                    if (pointer != e.getPointerId(0) || cancelled) return@setOnTouchListener true
                    val dx = e.rawX - startX; val dy = e.rawY - startY
                    if (abs(dx) > slop || abs(dy) > slop) { dragging = true; main.removeCallbacks(hold); removeMenu() }
                    if (dragging) {
                        val m = metrics(); p.x = (originX + dx).roundToInt().coerceIn(0, max(0, m.widthPixels - p.width))
                        p.y = (originY + dy).roundToInt().coerceIn(0, max(0, m.heightPixels - p.height))
                        try { wm.updateViewLayout(v, p); v.invalidate() } catch (_: Exception) { cancelled = true; removeWindow() }
                    }
                }
                MotionEvent.ACTION_UP -> {
                    main.removeCallbacks(hold)
                    if (!cancelled && pointer == e.getPointerId(0)) {
                        if (abs(e.rawX - startX) > slop || abs(e.rawY - startY) > slop) dragging = true
                        if (dragging) {
                            val m = metrics()
                            p.x = (originX + e.rawX - startX).roundToInt().coerceIn(0, max(0, m.widthPixels - p.width))
                            p.y = (originY + e.rawY - startY).roundToInt().coerceIn(0, max(0, m.heightPixels - p.height))
                            edge = if (p.x + p.width / 2 < m.widthPixels / 2) "left" else "right"
                            fraction = p.y.toDouble() / max(1, m.heightPixels - p.height)
                            place()
                            emit("SuperTaskLauncherPosition", Arguments.createMap().apply { putString("edge", edge); putDouble("position", fraction) })
                        } else if (!held && e.eventTime - downAt in 0..799 && e.eventTime - lastTap > 1500) {
                            lastTap = e.eventTime; v.performClick()
                        }
                    }
                    pointer = -1
                }
                MotionEvent.ACTION_CANCEL -> { cancelled = true; pointer = -1; main.removeCallbacks(hold); removeMenu(); place() }
                else -> { cancelled = true; main.removeCallbacks(hold) }
            }
            true
        }
    }

    private fun showMenu() {
        if (menuWindow != null || window == null || !enabled || suspended) return
        try {
            val m = metrics(); val button = params ?: return
            val width = minOf(dp(160), m.widthPixels); val height = minOf(dp(96), m.heightPixels)
            val menu = LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL; tag = "$tag.menu"
                background = GradientDrawable().apply { setColor(Color.WHITE); setStroke(dp(1), Color.BLACK) }
            }
            for ((label, action) in listOf("Hide" to { hideFromMenu() }, "Settings" to { launch("settings") })) {
                val row = TextView(context).apply {
                    text = label; textSize = 18f; setTextColor(Color.BLACK)
                    gravity = Gravity.CENTER_VERTICAL; setPadding(dp(12), 0, dp(12), 0)
                    contentDescription = "$label SuperTask launcher"; isClickable = true
                    setOnClickListener { action() }
                }
                // The menu is finger-only too. Drag/multi-contact/pen/cancel never
                // selects an item, and a held launcher UP cannot fall through here.
                var id = -1; var x = 0f; var y = 0f; var valid = false
                val slop = ViewConfiguration.get(context).scaledTouchSlop
                row.setOnTouchListener { v, e ->
                    if (e.pointerCount != 1 || e.getToolType(0) != MotionEvent.TOOL_TYPE_FINGER) { valid = false; return@setOnTouchListener true }
                    when (e.actionMasked) {
                        MotionEvent.ACTION_DOWN -> { id = e.getPointerId(0); x = e.rawX; y = e.rawY; valid = true }
                        MotionEvent.ACTION_MOVE -> if (id != e.getPointerId(0) || abs(e.rawX - x) > slop || abs(e.rawY - y) > slop) valid = false
                        MotionEvent.ACTION_UP -> { if (valid && id == e.getPointerId(0) && abs(e.rawX - x) <= slop && abs(e.rawY - y) <= slop) v.performClick(); valid = false }
                        else -> valid = false
                    }
                    true
                }
                menu.addView(row, LinearLayout.LayoutParams(width, height / 2))
            }
            val layout = WindowManager.LayoutParams(width, height,
                if (Build.VERSION.SDK_INT >= 26) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY else WindowManager.LayoutParams.TYPE_PHONE,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
                PixelFormat.TRANSLUCENT).apply {
                gravity = Gravity.TOP or Gravity.LEFT; title = "$tag.menu"
                x = (if (edge == "left") button.x + button.width else button.x - width).coerceIn(0, max(0, m.widthPixels - width))
                y = button.y.coerceIn(0, max(0, m.heightPixels - height))
            }
            menuWindow = menu; wm.addView(menu, layout); menu.invalidate()
            main.removeCallbacks(dismissMenu); main.postDelayed(dismissMenu, 10000)
        } catch (e: Exception) { removeMenu(); Log.w("TaskLauncher", "Menu unavailable", e) }
    }
    private fun removeMenu() {
        main.removeCallbacks(dismissMenu)
        try { menuWindow?.let { wm.removeViewImmediate(it) } } catch (_: Exception) {}
        finally { menuWindow = null }
    }
    private fun hideFromMenu() {
        if (!ownsLauncher()) { removeWindow(); return }
        ownership.edit().putBoolean("hidePending", true).apply()
        enabled = false; generation++; main.removeCallbacks(poll); removeWindow()
        emit("SuperTaskLauncherHide")
    }

    private fun launch(route: String = "tasks") {
        if (launching || disposed || !enabled || !ownsLauncher() || suspended || !screenOn()) return
        launching = true; generation++; removeWindow()
        val token = generation
        val submitted = submitWork {
            val foreground = try { readForeground() } catch (_: Exception) { false }
            main.post {
                // A configure/screen/lifecycle change already cleared this older
                // request and scheduled its own monitor. Do not clobber a newer
                // launch flag, and keep eligible visibility recovery running.
                if (token != generation) { if (!launching) schedule(); return@post }
                if (disposed || !ownsLauncher() || !enabled || suspended || !screenOn()) { launching = false; schedule(); return@post }
                if (foreground) openTasks(route) else { launching = false; schedule() }
            }
        }
        if (!submitted) { launching = false; schedule() }
    }
    private fun openTasks(route: String) {
        try {
            // Use the SDK's existing no-arg UI operation through its native Promise
            // signature. Opening natively wakes React when its timers are suspended.
            val manager = context.getNativeModule("NativePluginManager") ?: error("Plugin manager unavailable")
            val method = manager.javaClass.methods.firstOrNull { it.name == "showPluginView" && it.parameterTypes.contentEquals(arrayOf(Promise::class.java)) }
                ?: error("Plugin UI operation unavailable")
            val response = PromiseImpl(Callback {
                // The SDK has accepted its native UI operation. Do not mark React
                // foreground or route anywhere on rejection or a thrown invocation.
                main.post { if (!disposed && ownsLauncher()) emit("SuperTaskLauncherTap", Arguments.createMap().apply { putString("route", route) }) }
            }, Callback { args ->
                main.post { launching = false; emit("SuperTaskLauncherError", Arguments.createMap().apply { putString("message", "Could not open tasks") }); schedule() }
                Log.w("TaskLauncher", "showPluginView rejected (${args.size} fields)")
            })
            method.invoke(manager, response)
        } catch (e: Exception) {
            launching = false; Log.w("TaskLauncher", "Launch failed", e)
            emit("SuperTaskLauncherError", Arguments.createMap().apply { putString("message", "Could not open tasks") })
            schedule()
        }
    }

    private fun removeWindow() {
        removeMenu()
        removing = true
        try { window?.let { wm.removeViewImmediate(it) } } catch (_: Exception) {}
        finally { window = null; params = null; removing = false }
    }
    private fun clearOrphans() {
        if (!ownsLauncher()) return
        try {
            val klass = Class.forName("android.view.WindowManagerGlobal")
            val owner = klass.getMethod("getInstance").invoke(null)
            val field = klass.getDeclaredField("mViews").apply { isAccessible = true }
            val views = (field.get(owner) as? List<*>)?.toList() ?: return
            for (value in views) if (value is View && (value.tag == tag || value.tag == "$tag.menu") && value !== window && value !== menuWindow) try { wm.removeViewImmediate(value) } catch (_: Exception) {}
        } catch (e: Exception) { Log.w("TaskLauncher", "Tagged orphan inspection unavailable", e) }
    }
    override fun onHostResume() { main.post { emit("SuperTaskLauncherResume"); schedule() } }
    override fun onHostPause() {}
    override fun onHostDestroy() { stop() }
    override fun invalidate() { dispose(); super.invalidate() }
    private fun dispose() {
        disposed = true
        main.post { enabled = false; generation++; main.removeCallbacks(poll); removeWindow(); clearOrphans() }
        context.removeLifecycleEventListener(this)
        try { context.unregisterReceiver(screenReceiver) } catch (_: Exception) {}
        worker.shutdownNow()
    }
}
