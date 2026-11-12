// Reference: ../refs/DAF/daf3/apps/mobile/android/app/src/main/java/com/daehanaifactory/dafmobile/NodeRuntime.kt (built-in runtime only).
package kr.goltou.auto

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.net.ServerSocket
import java.security.SecureRandom

object NodeRuntime {
    @Volatile var port = 0; private set
    @Volatile var token = ""; private set
    @Volatile var exitCode: Int? = null; private set
    @Volatile private var started = false
    init { System.loadLibrary("node"); System.loadLibrary("goltounode") }
    private external fun startNode(arguments: Array<String>): Int

    @Synchronized
    fun ensureStarted(context: Context, devtools: File) {
        if (started) return
        val manifest = context.assets.open("bundle/manifest.json").bufferedReader().use { JSONObject(it.readText()) }
        val bundle = File(context.filesDir, "builtin-${manifest.getString("sha256").take(16)}")
        copyAssets(context, "bundle", bundle)
        port = ServerSocket(0).use { it.localPort }
        token = ByteArray(32).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
        val args = arrayOf("node", File(bundle, "core.cjs").absolutePath,
            "--port", port.toString(), "--token", token, "--devtools", devtools.absolutePath, "--bundle", bundle.absolutePath,
            "--debug", BuildConfig.DEBUG.toString(), "--data", File(context.filesDir, "wp0").absolutePath)
        started = true
        Thread(null, {
            exitCode = startNode(args)
            Log.e("GOLTOU", "Node exited: $exitCode")
        }, "goltou-node", 16L * 1024 * 1024).start()
    }

    private fun copyAssets(context: Context, source: String, target: File) {
        val children = context.assets.list(source) ?: emptyArray()
        if (children.isNotEmpty()) {
            target.mkdirs()
            children.forEach { copyAssets(context, "$source/$it", File(target, it)) }
        } else if (!target.isFile) {
            target.parentFile?.mkdirs()
            context.assets.open(source).use { input -> target.outputStream().use { input.copyTo(it) } }
        }
    }
}
