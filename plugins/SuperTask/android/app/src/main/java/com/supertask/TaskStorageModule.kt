package com.supertask

import android.system.Os
import android.system.OsConstants
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
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
            val sdkDir = File(pluginDir).canonicalFile
            val allowed = File(reactApplicationContext.applicationContext.filesDir, "plugins/supertask001").canonicalFile
            require(sdkDir == allowed) { "PluginHost returned an unexpected private directory" }
            val dir = File(sdkDir, "offline-v1")
            require(dir.isDirectory || dir.mkdirs()) { "Cannot create private task directory" }
            root = dir
            val identity = File(dir, "device-id")
            if (!identity.exists()) atomicWrite(identity, UUID.randomUUID().toString())
            val deviceId = identity.readText(Charsets.UTF_8).trim()
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
