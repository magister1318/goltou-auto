// Reference: ../refs/DAF/daf3/apps/mobile/android/app/src/main/java/com/daehanaifactory/dafmobile/MainActivity.kt (local UI and health wait only).
package kr.goltou.auto

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.graphics.Color
import android.os.Bundle
import android.view.View
import android.view.WindowInsets
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.ByteArrayInputStream
import java.util.concurrent.TimeUnit
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback

class MainActivity : ComponentActivity() {
    private lateinit var ui: WebView
    private lateinit var surfaces: SurfaceHost
    private lateinit var link: CoreLink

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WebView.setWebContentsDebuggingEnabled(true)
        val root = FrameLayout(this)
        root.setOnApplyWindowInsetsListener { view, insets ->
            val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
        val hidden = FrameLayout(this)
        root.addView(hidden, FrameLayout.LayoutParams(-1, -1))
        val relay = DevtoolsRelay.get(filesDir)
        NodeRuntime.ensureStarted(applicationContext, relay.socketFile)
        val origin = "http://127.0.0.1:${NodeRuntime.port}"
        ui = WebView(this).apply {
            setBackgroundColor(Color.WHITE)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = !request.url.toString().startsWith("$origin/ui/")
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                    if (request.url.toString().startsWith("$origin/")) return null
                    return WebResourceResponse("text/plain", "UTF-8", ByteArrayInputStream(ByteArray(0)))
                }
            }
        }
        root.addView(ui, FrameLayout.LayoutParams(-1, -1))
        val visible = FrameLayout(this).apply { visibility = View.GONE }
        root.addView(visible, FrameLayout.LayoutParams(-1, -1))
        surfaces = SurfaceHost(this, hidden, visible)
        link = CoreLink { op, msg, reply -> surfaces.handle(op, msg, reply) }
        setContentView(root)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { if (!surfaces.hideTop()) finish() }
        })
        Thread {
            val client = OkHttpClient.Builder().connectTimeout(500, TimeUnit.MILLISECONDS).readTimeout(1, TimeUnit.SECONDS).build()
            repeat(120) {
                if (isDestroyed) return@Thread
                try {
                    val request = Request.Builder().url("$origin/health?token=${NodeRuntime.token}").build()
                    client.newCall(request).execute().use { response ->
                        if (response.isSuccessful) {
                            runOnUiThread { if (!isDestroyed) { link.connect(); ui.loadUrl("$origin/ui/?token=${NodeRuntime.token}") } }
                            return@Thread
                        }
                    }
                } catch (_: Exception) {}
                Thread.sleep(250)
            }
            runOnUiThread {
                if (!isDestroyed) AlertDialog.Builder(this).setTitle("골투오토 시작 실패")
                    .setMessage("코어가 응답하지 않습니다. 앱을 다시 실행해 주세요.").setPositiveButton("닫기") { _, _ -> finish() }.show()
            }
        }.start()
    }

    override fun onDestroy() { link.close(); surfaces.close(); ui.destroy(); super.onDestroy() }
}
