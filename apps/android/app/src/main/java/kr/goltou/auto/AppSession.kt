package kr.goltou.auto

import android.app.Application
import android.content.MutableContextWrapper
import android.content.pm.ActivityInfo
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.os.Build
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.lifecycle.AndroidViewModel
import org.json.JSONObject
import java.io.File

/** Keeps the UI, CDP targets and native socket together across Activity recreation. */
class AppSession(application: Application) : AndroidViewModel(application) {
    val context = MutableContextWrapper(application)
    lateinit var root: FrameLayout
    lateinit var ui: WebView
    lateinit var surfaces: SurfaceHost
    lateinit var link: CoreLink
    val initialized get() = ::ui.isInitialized
    var activity: MainActivity? = null
    var disposed = false
    var foreground = false
    var creations = 1
    var resumes = 0
    var pauses = 0
    private val started = SystemClock.elapsedRealtime()
    var uiReadyMs: Long = 0
    fun markUiReady() { if (uiReadyMs == 0L) uiReadyMs = SystemClock.elapsedRealtime() - started }

    fun handleDebug(op: String, msg: JSONObject, reply: (JSONObject?, String?) -> Unit) {
        check(BuildConfig.DEBUG) { "DEBUG_ONLY" }
        when (op) {
            "debug.info" -> reply(surfaces.info().put("activityCreations", creations)
                .put("resumes", resumes).put("pauses", pauses).put("foreground", foreground)
                .put("uiReadyMs", uiReadyMs)
                .put("model", Build.MODEL).put("androidSdk", Build.VERSION.SDK_INT)
                .put("shellElapsedMs", SystemClock.elapsedRealtime() - started), null)
            "debug.lifecycle" -> {
                val current = activity ?: error("NO_ACTIVITY")
                check(foreground) { "APP_NOT_FOREGROUND" }
                val mode = msg.getString("mode")
                reply(JSONObject().put("accepted", true), null)
                Handler(Looper.getMainLooper()).postDelayed({
                    when (mode) {
                        "recreate" -> current.recreate()
                        "rotate" -> current.requestedOrientation = if (current.resources.configuration.orientation == 1)
                            ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE else ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
                        "background" -> {
                            current.moveTaskToBack(true)
                            // Android may forbid background activity starts. Return is a user action
                            // (or an explicit adb launch of this package during WP0), never another app.
                        }
                    }
                }, 250)
            }
            "debug.capture" -> {
                check(foreground) { "APP_NOT_FOREGROUND" }
                val name = msg.getString("name")
                require(name.matches(Regex("[a-zA-Z0-9-]{1,100}")))
                val view = surfaces.view(msg.getString("surface"))
                val bitmap = Bitmap.createBitmap(view.width.coerceAtLeast(1), view.height.coerceAtLeast(1), Bitmap.Config.ARGB_8888)
                val canvas = Canvas(bitmap)
                canvas.drawColor(Color.WHITE)
                if (!msg.optBoolean("sensitive", true)) view.draw(canvas)
                // Geometry only comes from a read-only DOM scan. Never store page text or input values.
                val paint = Paint().apply { color = Color.BLACK }
                val masks = msg.getJSONArray("masks")
                @Suppress("DEPRECATION")
                val scale = view.scale
                for (index in 0 until masks.length()) {
                    val rect = masks.getJSONArray(index)
                    canvas.drawRect(rect.getDouble(0).toFloat() * scale - 4, rect.getDouble(1).toFloat() * scale - 4,
                        rect.getDouble(2).toFloat() * scale + 4, rect.getDouble(3).toFloat() * scale + 4, paint)
                }
                val dir = File(context.filesDir, "wp0").apply { mkdirs() }
                File(dir, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
                bitmap.recycle()
                reply(JSONObject().put("file", "$name.png").put("redacted", true), null)
            }
            else -> error("UNKNOWN_DEBUG_OP")
        }
    }

    override fun onCleared() {
        disposed = true
        if (initialized) {
            link.close(); surfaces.close()
            (ui.parent as? android.view.ViewGroup)?.removeView(ui)
            ui.destroy()
        }
        context.baseContext = getApplication<Application>()
    }
}
