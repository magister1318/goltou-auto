package kr.goltou.auto

import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import okhttp3.Call
import okhttp3.CookieJar
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.URI
import java.util.UUID
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Retained with AppSession. No credentials, cookies, download manager or public storage. */
class AppUpdate(private val session: AppSession) {
    private val context get() = session.context
    private val directory = File(context.cacheDir, "updates").apply {
        mkdirs()
        // A new process never reuses an unverified or previously offered APK.
        listFiles()?.filter { it.isFile }?.forEach { it.delete() }
    }
    private val client = OkHttpClient.Builder().cookieJar(CookieJar.NO_COOKIES)
        .followRedirects(false).followSslRedirects(false)
        .connectTimeout(20, TimeUnit.SECONDS).readTimeout(45, TimeUnit.SECONDS)
        .callTimeout(30, TimeUnit.MINUTES).build()
    @Volatile private var call: Call? = null
    @Volatile private var working = false
    private var cancelled = AtomicBoolean(false)
    @Volatile private var verified: File? = null
    @Volatile private var expectedHash: String? = null

    private fun event(name: String, data: JSONObject) { session.link.event(name, data) }
    private fun log(name: String, code: String? = null, bytes: Long? = null, duration: Long? = null) {
        val data = JSONObject().put("event", name)
        if (code != null) data.put("code", code)
        if (bytes != null) data.put("bytes", bytes)
        if (duration != null) data.put("duration", duration)
        event("update.log", data)
    }
    fun handle(op: String, msg: JSONObject, reply: (JSONObject?, String?) -> Unit) {
        when (op) {
            "update.download" -> download(msg, reply)
            "update.cancel" -> { cancel(); reply(JSONObject(), null) }
            "update.install" -> {
                try {
                    val allowed = context.packageManager.canRequestPackageInstalls()
                    log(if (allowed) "permission_yes" else "permission_no")
                    if (!allowed) reply(JSONObject().put("status", "permission"), null)
                    else install(reply)
                } catch (_: Exception) { discard(); reply(null, "UPDATE_INSTALL_FAILED") }
            }
            "update.settings" -> {
                try {
                    val activity = session.activity ?: error("NO_ACTIVITY")
                    activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:kr.goltou.auto")))
                    log("settings_opened"); reply(JSONObject(), null)
                } catch (_: Exception) { reply(null, "UPDATE_INSTALL_FAILED") }
            }
            else -> reply(null, "UPDATE_INSTALL_FAILED")
        }
    }
    private fun download(msg: JSONObject, reply: (JSONObject?, String?) -> Unit) {
        if (working) { reply(null, "UPDATE_DOWNLOAD_FAILED"); return }
        val release = msg.getJSONObject("release")
        val hash = release.optString("sha256")
        val size = release.optLong("size", -1)
        val url = try { downloadUrl(msg.getString("apiBase"), release.getString("url")) }
            catch (_: Exception) { reply(null, "UPDATE_METADATA_INVALID"); return }
        if (!Regex("[a-fA-F0-9]{64}").matches(hash) || size < 1) { reply(null, "UPDATE_METADATA_INVALID"); return }
        discard()
        working = true
        val stop = AtomicBoolean(false); cancelled = stop
        val file = File(directory, "update-${UUID.randomUUID()}.apk")
        Thread {
            var bytes = 0L
            val start = android.os.SystemClock.elapsedRealtime()
            var keep = false
            var downloadEnded = false
            var failure: String? = null
            log("download_start")
            try {
                val request = client.newCall(Request.Builder().url(url).get().build()); call = request
                if (stop.get()) throw UpdateFailure("UPDATE_CANCELLED")
                request.execute().use { response ->
                    if (response.code in 400..499) throw UpdateFailure("UPDATE_LINK_EXPIRED")
                    if (!response.isSuccessful || response.header("Content-Type")?.substringBefore(';')?.trim() != "application/vnd.android.package-archive")
                        throw UpdateFailure("UPDATE_DOWNLOAD_FAILED")
                    val body = response.body ?: throw UpdateFailure("UPDATE_DOWNLOAD_FAILED")
                    body.byteStream().use { input ->
                        FileOutputStream(file).use { output ->
                            val buffer = ByteArray(64 * 1024)
                            var lastEvent = 0L
                            while (true) {
                                if (stop.get()) throw UpdateFailure("UPDATE_CANCELLED")
                                val count = input.read(buffer)
                                if (count < 0) break
                                bytes += count
                                if (bytes > size) throw UpdateFailure("UPDATE_DOWNLOAD_FAILED")
                                output.write(buffer, 0, count)
                                val now = android.os.SystemClock.elapsedRealtime()
                                if (now - lastEvent >= 200) { event("update.progress", JSONObject().put("bytes", bytes)); lastEvent = now }
                            }
                            output.fd.sync()
                        }
                    }
                }
                if (bytes != size) throw UpdateFailure("UPDATE_DOWNLOAD_FAILED")
                log("download_end", bytes = bytes, duration = android.os.SystemClock.elapsedRealtime() - start)
                downloadEnded = true
                event("update.progress", JSONObject().put("bytes", bytes))
                verify(file, hash, stop)
                if (stop.get()) throw UpdateFailure("UPDATE_CANCELLED")
                verified = file; expectedHash = hash; keep = true
            } catch (e: Exception) {
                val reason = if (stop.get()) "UPDATE_CANCELLED" else (e as? UpdateFailure)?.reason ?: "UPDATE_DOWNLOAD_FAILED"
                if (!downloadEnded) log("download_end", reason, bytes, android.os.SystemClock.elapsedRealtime() - start)
                failure = reason
            } finally {
                call = null
                if (!keep || stop.get()) { file.delete(); if (verified == file) { verified = null; expectedHash = null } }
                working = false
            }
            reply(if (failure == null) JSONObject() else null, failure)
        }.start()
    }

    @Suppress("DEPRECATION")
    private fun signers(info: PackageInfo): Set<String> {
        val values = if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners else info.signatures
        return values?.map { UpdateVerification.certificate(it.toByteArray()) }?.toSet() ?: emptySet()
    }
    @Suppress("DEPRECATION")
    private fun verify(file: File, hash: String, stop: AtomicBoolean) {
        val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
        val installed = context.packageManager.getPackageInfo(context.packageName, flags)
        UpdateVerification.verify(file, hash, BuildConfig.VERSION_CODE.toLong(), signers(installed), {
            context.packageManager.getPackageArchiveInfo(file.absolutePath, flags)?.let {
                UpdateArchive(it.packageName, if (Build.VERSION.SDK_INT >= 28) it.longVersionCode else it.versionCode.toLong(), signers(it))
            }
        }, { stop.get() }) { step, reason -> log(step, reason) }
    }
    private fun install(reply: (JSONObject?, String?) -> Unit) {
        val file = verified ?: throw UpdateFailure("UPDATE_INSTALL_FAILED")
        val hash = expectedHash ?: throw UpdateFailure("UPDATE_INSTALL_FAILED")
        // Permission settings may have kept the file for minutes: verify again before sharing it.
        Thread {
            try {
                verify(file, hash, cancelled)
                session.root.post {
                    try {
                        if (cancelled.get() || verified != file) throw UpdateFailure("UPDATE_CANCELLED")
                        val activity = session.activity ?: error("NO_ACTIVITY")
                        val uri = FileProvider.getUriForFile(activity, "kr.goltou.auto.updates", file)
                        activity.openUpdateInstaller(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
                        log("installer_launched")
                        reply(JSONObject().put("status", "launched"), null)
                    } catch (_: Exception) { discard(); reply(null, "UPDATE_INSTALL_FAILED") }
                }
            } catch (e: Exception) { discard(); reply(null, (e as? UpdateFailure)?.reason ?: "UPDATE_INSTALL_FAILED") }
        }.start()
    }
    fun installerResult(status: Int) {
        event("update.log", JSONObject().put("event", "installer_result").put("status", status))
        discard()
    }
    private fun discard() { verified?.delete(); verified = null; expectedHash = null }
    fun cancel() { cancelled.set(true); call?.cancel(); discard() }

    companion object {
        /** Only the API's same-origin relative GET route; redirects and credentials are forbidden. */
        fun downloadUrl(base: String, relative: String): String {
            require(Regex("auto_app/get/[A-Za-z0-9_-]+").matches(relative))
            val origin = URI(base.trimEnd('/') + "/")
            require(origin.scheme == "https" && origin.host != null && origin.userInfo == null && origin.query == null && origin.fragment == null)
            val url = origin.resolve(relative)
            require(url.host == origin.host && url.port == origin.port && url.scheme == origin.scheme)
            return url.toASCIIString()
        }
    }
}
