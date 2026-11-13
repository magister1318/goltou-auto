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
import androidx.lifecycle.ViewModelProvider

class MainActivity : ComponentActivity() {
    private lateinit var ui: WebView
    private lateinit var surfaces: SurfaceHost
    private lateinit var link: CoreLink
    private lateinit var session: AppSession

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        session = ViewModelProvider(this)[AppSession::class.java]
        val retained = session
        session.activity = this
        if (session.initialized) {
            ui = session.ui; surfaces = session.surfaces; link = session.link
            session.context.baseContext = this
            (session.root.parent as? android.view.ViewGroup)?.removeView(session.root)
            setContentView(session.root)
            installBackHandler()
            session.creations++
            return
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        val root = FrameLayout(session.context)
        root.setOnApplyWindowInsetsListener { view, insets ->
            val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
        val hidden = FrameLayout(session.context)
        root.addView(hidden, FrameLayout.LayoutParams(-1, -1))
        val relay = DevtoolsRelay.get(filesDir)
        NodeRuntime.ensureStarted(applicationContext, relay.socketFile, intent.getBooleanExtra("verification-fixture", false), intent.getStringExtra("verification-title"))
        val origin = "http://127.0.0.1:${NodeRuntime.port}"
        ui = WebView(session.context).apply {
            setBackgroundColor(Color.WHITE)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView, url: String) { retained.markUiReady() }
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = !request.url.toString().startsWith("$origin/ui/")
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                    if (request.url.toString().startsWith("$origin/")) return null
                    return WebResourceResponse("text/plain", "UTF-8", ByteArrayInputStream(ByteArray(0)))
                }
            }
        }
        root.addView(ui, FrameLayout.LayoutParams(-1, -1))
        val visible = FrameLayout(session.context).apply { visibility = View.GONE }
        root.addView(visible, FrameLayout.LayoutParams(-1, -1))
        surfaces = SurfaceHost(session.context, hidden, visible) { id -> retained.link.event("surface.hidden", org.json.JSONObject().put("surface", id)) }
        retained.surfaces = surfaces
        link = CoreLink { op, msg, reply ->
            if (op.startsWith("debug.")) retained.handleDebug(op, msg, reply)
            else retained.surfaces.handle(op, msg, reply)
        }
        session.ui = ui; session.surfaces = surfaces; session.link = link; session.root = root
        session.context.baseContext = this
        setContentView(root)
        installBackHandler()
        Thread {
            val client = OkHttpClient.Builder().connectTimeout(500, TimeUnit.MILLISECONDS).readTimeout(1, TimeUnit.SECONDS).build()
            repeat(120) {
                if (session.disposed) return@Thread
                try {
                    val request = Request.Builder().url("$origin/health?token=${NodeRuntime.token}").build()
                    client.newCall(request).execute().use { response ->
                        if (response.isSuccessful) {
                            session.root.post { if (!session.disposed) { link.connect(); ui.loadUrl("$origin/ui/?token=${NodeRuntime.token}") } }
                            return@Thread
                        }
                    }
                } catch (_: Exception) {}
                Thread.sleep(250)
            }
            session.root.post {
                session.activity?.let { current ->
                    if (!current.isDestroyed) AlertDialog.Builder(current).setTitle("골투오토 시작 실패")
                        .setMessage("코어가 응답하지 않습니다. 앱을 다시 실행해 주세요.").setPositiveButton("닫기") { _, _ -> current.finish() }.show()
                }
            }
        }.start()
    }

    private fun installBackHandler() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { if (!surfaces.hideTop()) { if (ui.canGoBack()) ui.goBack() else finish() } }
        })
    }

    override fun onResume() { super.onResume(); if (::session.isInitialized) { session.foreground = true; session.resumes++ } }
    override fun onPause() { if (::session.isInitialized) { session.foreground = false; session.pauses++ }; super.onPause() }
    override fun onDestroy() {
        if (::session.isInitialized && session.activity === this) {
            session.activity = null
            if (isChangingConfigurations) {
                (session.root.parent as? android.view.ViewGroup)?.removeView(session.root)
                session.context.baseContext = applicationContext
            }
        }
        super.onDestroy()
    }
}
