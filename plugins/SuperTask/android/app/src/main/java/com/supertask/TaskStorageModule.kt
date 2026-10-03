package com.supertask

import android.system.Os
import android.system.OsConstants
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.util.UUID

/** Durable, strictly plugin-private generations. Never falls back to sdcard. */
class TaskStorageModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "TaskStorage"
    private val lock = Any()
    private var root: File? = null

    private fun hash(value: String) = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

    private fun directory(): File = root ?: throw IllegalStateException("Private task storage is not initialized")

    private fun prepareDirectory(pluginDir: String): File {
        val sdkDir = File(pluginDir).canonicalFile
        val allowed = File(reactApplicationContext.applicationContext.filesDir, "plugins/supertask001").canonicalFile
        require(sdkDir == allowed) { "PluginHost returned an unexpected private directory" }
        val dir = File(sdkDir, "offline-v1")
        require(dir.isDirectory || dir.mkdirs()) { "Cannot create private task directory" }
        root = dir
        return dir
    }

    @ReactMethod
    fun prepare(pluginDir: String, promise: Promise) = synchronized(lock) {
        try { promise.resolve(prepareDirectory(pluginDir).absolutePath) }
        catch (error: Exception) { promise.reject("TASK_STORAGE_INIT", error) }
    }

    private fun previewFile(path: String): File {
        val file = File(path).canonicalFile
        require(file.parentFile == directory().canonicalFile &&
            file.name.matches(Regex("capture-[a-f0-9-]{36}\\.png"))) { "Invalid temporary preview path" }
        return file
    }

    @ReactMethod
    fun readPreview(path: String, rotation: Double, promise: Promise) = synchronized(lock) {
        val bitmaps = mutableListOf<Bitmap>()
        try {
            val file = previewFile(path)
            require(file.length() in 1..8_000_000) { "Preview too large or missing" }
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(file.path, bounds)
            require(bounds.outWidth > 0 && bounds.outHeight > 0 &&
                bounds.outWidth.toLong() * bounds.outHeight <= 12_000_000) { "Preview dimensions invalid" }
            val original = BitmapFactory.decodeFile(file.path) ?: error("Invalid preview")
            bitmaps.add(original)
            val white = Bitmap.createBitmap(original.width, original.height, Bitmap.Config.ARGB_8888)
            bitmaps.add(white)
            Canvas(white).apply { drawColor(Color.WHITE); drawBitmap(original, 0f, 0f, null) }
            require(rotation.isFinite() && rotation in -360.0..360.0) { "Invalid preview rotation" }
            val rotated = if (rotation == 0.0) white else Bitmap.createBitmap(white, 0, 0,
                white.width, white.height, Matrix().apply { postRotate(rotation.toFloat()) }, true)
            if (rotated !== white) bitmaps.add(rotated)
            val bytes = ByteArrayOutputStream().use { stream ->
                rotated.compress(Bitmap.CompressFormat.PNG, 100, stream)
                stream.toByteArray()
            }
            require(bytes.size <= 8_000_000) { "Preview too large" }
            promise.resolve(Base64.encodeToString(bytes, Base64.NO_WRAP))
        } catch (error: Exception) { promise.reject("PREVIEW_READ", "Could not read selected handwriting image") }
        finally { bitmaps.distinct().forEach { it.recycle() } }
    }

    @ReactMethod
    fun deletePreview(path: String, promise: Promise) = synchronized(lock) {
        try {
            val file = previewFile(path)
            require(!file.exists() || file.delete()) { "Cannot remove temporary preview" }
            promise.resolve(null)
        } catch (error: Exception) { promise.reject("PREVIEW_DELETE", error) }
    }

    @ReactMethod
    fun readSettings(promise: Promise) = synchronized(lock) {
        try {
            val file = File(directory(), "settings.json")
            val backup = File(directory(), "settings.previous")
            val payload = generation(file) ?: generation(backup)
            require(payload != null || (!file.exists() && !backup.exists())) { "Private settings are damaged; keep files for recovery" }
            promise.resolve(payload)
        } catch (error: Exception) { promise.reject("SETTINGS_READ", error) }
    }

    @ReactMethod
    fun saveSettings(payload: String, promise: Promise) = synchronized(lock) {
        try {
            diskLock {
                JSONObject(payload)
                val file = File(directory(), "settings.json")
                val old = generation(file) ?: generation(File(directory(), "settings.previous"))
                require(old != null || !file.exists()) { "Private settings are damaged; refusing replacement" }
                if (old != null) atomicWrite(File(directory(), "settings.previous"), envelope(old))
                atomicWrite(file, envelope(payload))
                promise.resolve(true)
            }
        } catch (error: Exception) { promise.reject("SETTINGS_WRITE", error) }
    }

    private fun accountFile(account: String, suffix: String): File {
        require(account.matches(Regex("[a-f0-9]{64}"))) { "Invalid account storage key" }
        return File(directory(), "account-$account.$suffix")
    }

    private fun syncDirectory(dir: File) {
        val fd = Os.open(dir.absolutePath, OsConstants.O_RDONLY, 0)
        try { Os.fsync(fd) } finally { Os.close(fd) }
    }

    private fun atomicWrite(file: File, payload: String) {
        val temporary = File(file.parentFile, file.name + ".tmp")
        FileOutputStream(temporary).use { stream ->
            stream.write(payload.toByteArray(Charsets.UTF_8))
            stream.fd.sync()
        }
        Os.rename(temporary.absolutePath, file.absolutePath)
        syncDirectory(file.parentFile!!)
    }

    private fun envelope(payload: String): String = JSONObject()
        .put("checksum", hash(payload)).put("payload", payload).toString()

    private fun <T> diskLock(block: () -> T): T {
        FileOutputStream(File(directory(), "writer.lock"), true).channel.use { channel ->
            channel.lock().use { return block() }
        }
    }

    private fun generation(file: File): String? {
        if (!file.exists()) return null
        return try {
            val obj = JSONObject(file.readText(Charsets.UTF_8))
            val payload = obj.getString("payload")
            require(obj.getString("checksum") == hash(payload)) { "Checksum mismatch" }
            payload
        } catch (_: Exception) { null }
    }

    @ReactMethod
    fun initialize(pluginDir: String, token: String, promise: Promise) = synchronized(lock) {
        try {
            require(token.isNotBlank()) { "Configure a Todoist token before capturing offline tasks" }
            // SDK directory and Android app-private identity must agree. A wrong
            // context fails visibly rather than leaking to shared storage.
            val dir = prepareDirectory(pluginDir)
            val identity = File(dir, "device-id")
            val deviceId = diskLock {
                if (!identity.exists()) atomicWrite(identity, UUID.randomUUID().toString())
                identity.readText(Charsets.UTF_8).trim()
            }
            UUID.fromString(deviceId)
            val account = hash(token)
            val otherStores = dir.listFiles()?.count { it.name.startsWith("account-") &&
                it.name.endsWith(".json") && it.name != "account-$account.json" } ?: 0
            promise.resolve(JSONObject().put("accountKey", account).put("deviceId", deviceId)
                .put("otherAccountStores", otherStores).toString())
        } catch (error: Exception) {
            promise.reject("TASK_STORAGE_INIT", "Private task storage unavailable: ${error.message}", error)
        }
    }

    @ReactMethod
    fun newIds(count: Int, promise: Promise) {
        try {
            require(count in 1..10000)
            val ids = org.json.JSONArray()
            repeat(count) { ids.put(UUID.randomUUID().toString()) }
            promise.resolve(ids.toString())
        } catch (error: Exception) { promise.reject("TASK_IDS", error) }
    }

    @ReactMethod
    fun read(account: String, promise: Promise) = synchronized(lock) {
        try {
            val main = accountFile(account, "json")
            val backup = accountFile(account, "previous")
            val obj = JSONObject().put("exists", main.exists() || backup.exists())
                .put("main", generation(main) ?: JSONObject.NULL)
                .put("backup", generation(backup) ?: JSONObject.NULL)
            promise.resolve(obj.toString())
        } catch (error: Exception) { promise.reject("TASK_STORAGE_READ", error) }
    }

    @ReactMethod
    fun commit(account: String, payload: String, previous: String, promise: Promise) = synchronized(lock) {
        try {
          diskLock {
            val next = JSONObject(payload)
            val old = JSONObject(previous)
            require(next.getString("accountKey") == account && old.getString("accountKey") == account)
            require(next.getLong("revision") == old.getLong("revision") + 1)
            val current = generation(accountFile(account, "json"))
            val recovered = generation(accountFile(account, "previous"))
            // A stale React context must not replace newer captured tasks.
            if (current != null) {
                require(current == previous) { "Task storage changed in another session; reopen SuperTask before saving" }
            } else if (recovered != null) {
                require(recovered == previous) { "Recovery generation changed; reopen SuperTask before saving" }
            } else {
                require(!accountFile(account, "json").exists() && !accountFile(account, "previous").exists()) {
                    "Task storage is damaged; refusing to replace it"
                }
                require(old.getLong("revision") == 0L)
            }
            // Previous comes from the validated committed model, not a possibly
            // corrupt main file. Recovery never replaces a good backup with bad data.
            atomicWrite(accountFile(account, "previous"), envelope(previous))
            atomicWrite(accountFile(account, "json"), envelope(payload))
            promise.resolve(true)
          }
        } catch (error: Exception) {
            promise.reject("TASK_STORAGE_WRITE", "Task save failed; keep this screen open: ${error.message}", error)
        }
    }
}
