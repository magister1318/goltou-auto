// Reference: ../refs/DAF/daf3/apps/mobile/android/app/src/main/java/com/daehanaifactory/dafmobile/SurfaceHost.kt (profile/layer lifecycle only).
package kr.goltou.auto

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.net.Uri
import android.view.View
import android.view.ViewGroup
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.ConsoleMessage
import android.webkit.JsResult
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebResourceError
import android.webkit.WebResourceResponse
import android.os.Message
import java.io.ByteArrayInputStream
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import androidx.webkit.ProfileStore
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import androidx.webkit.WebStorageCompat
import org.json.JSONObject
import org.json.JSONArray

class SurfaceHost(private val context: Context, private val hidden: FrameLayout, private val visible: FrameLayout,
    private val onUserHidden: (String) -> Unit, private val onNavigationHidden: (String) -> Unit) {
    private data class PendingDialog(val id: String, val kind: String, val message: String, val url: String, val result: JsResult)
    private data class Entry(val view: WebView, val session: String, var frame: View, val bootstrapUrl: String, var dialog: PendingDialog? = null,
        @Volatile var policy: NavigationPolicy? = null, var loadedUrl: String? = null, var loadFailed: Boolean = false)
    private var dialogSerial = 0
    private val entries = java.util.concurrent.ConcurrentHashMap<String, Entry>()
    private val sessions = setOf("naver", "band", "ai")
    private val clearing = mutableSetOf<String>()

    fun view(id: String): WebView = entries[id]?.view ?: error("NO_SURFACE")

    fun info(): JSONObject {
        val multi = WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)
        val profiles = if (multi) sessions.map { name ->
            val probe = WebView(context)
            try {
                WebViewCompat.setProfile(probe, "goltou-$name")
                WebViewCompat.getProfile(probe).name
            } finally { probe.destroy() }
        } else emptyList()
        return JSONObject().put("webViewVersion", WebViewCompat.getCurrentWebViewPackage(context)?.versionName ?: "unknown")
            .put("multiProfile", multi).put("deleteBrowsingData", WebViewFeature.isFeatureSupported(WebViewFeature.DELETE_BROWSING_DATA))
            .put("profiles", JSONArray(profiles)).put("profilesDistinct", profiles.size == 3 && profiles.toSet().size == 3)
            .put("surfaceCount", entries.size)
    }

    fun handle(op: String, msg: JSONObject, reply: (JSONObject?, String?) -> Unit) {
        when (op) {
            "surface.create" -> create(msg)
            "surface.destroy" -> destroy(msg.getString("surface"))
            "surface.visible" -> setVisible(msg.getString("surface"), msg.getBoolean("visible"))
            "surface.navigation" -> {
                val entry = entries[msg.getString("surface")] ?: error("NO_SURFACE")
                check(entry.policy == null) { "NAVIGATION_POLICY_ALREADY_SET" }
                val policy = msg.getJSONObject("policy")
                fun routes(name: String): List<NavigationRoute> {
                    val rows = policy.getJSONArray(name)
                    return (0 until rows.length()).map { i -> rows.getJSONObject(i).let {
                        NavigationRoute(it.getString("hostname"), it.getString("pathname"), it.optBoolean("prefix"))
                    } }
                }
                val parsed = NavigationPolicy(routes("allowed"), routes("landing"), policy.getString("fallbackUrl"))
                check(parsed.allows(parsed.fallbackUrl)) { "INVALID_NAVIGATION_FALLBACK" }
                entry.policy = parsed
                entry.view.settings.setSupportMultipleWindows(true)
            }
            "surface.dialog" -> {
                val pending = entries[msg.getString("surface")]?.dialog
                reply(JSONObject().put("dialog", if (pending == null) JSONObject.NULL else JSONObject()
                    .put("id", pending.id).put("kind", pending.kind).put("message", pending.message).put("url", pending.url)), null)
                return
            }
            "surface.dialog.answer" -> {
                val entry = entries[msg.getString("surface")] ?: error("NO_SURFACE")
                val pending = entry.dialog ?: error("NO_DIALOG")
                check(pending.id == msg.getString("dialog")) { "DIALOG_ID_MISMATCH" }
                entry.dialog = null
                if (msg.getBoolean("accept")) pending.result.confirm() else pending.result.cancel()
            }
            "profile.clear" -> {
                val session = session(msg)
                requireProfiles()
                check(WebViewFeature.isFeatureSupported(WebViewFeature.DELETE_BROWSING_DATA)) { "WEBVIEW_DELETE_BROWSING_DATA_REQUIRED" }
                check(session !in clearing) { "SESSION_CLEAR_IN_PROGRESS" }
                entries.filterValues { it.session == session }.keys.toList().forEach { destroy(it) }
                val profile = ProfileStore.getInstance().getOrCreateProfile("goltou-$session")
                // Clears cookies, cache and JavaScript storage, and replies only after completion.
                // ProfileStore.deleteProfile cannot delete profiles loaded in this process.
                clearing.add(session)
                try {
                    WebStorageCompat.deleteBrowsingData(profile.webStorage) {
                        clearing.remove(session)
                        reply(JSONObject(), null)
                    }
                } catch (error: Exception) { clearing.remove(session); throw error }
                return
            }
            else -> error("UNKNOWN_NATIVE_OP")
        }
        reply(JSONObject(), null)
    }

    private fun session(msg: JSONObject) = msg.getString("session").also { require(it in sessions) { "INVALID_SESSION" } }
    private fun requireProfiles() {
        check(WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) { "WEBVIEW_MULTI_PROFILE_REQUIRED: Android System WebView를 업데이트해 주세요" }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun create(msg: JSONObject) {
        requireProfiles()
        val id = msg.getString("surface")
        require(!entries.containsKey(id)) { "SURFACE_ALREADY_EXISTS" }
        val session = session(msg)
        check(session !in clearing) { "SESSION_CLEAR_IN_PROGRESS" }
        val view = WebView(context)
        // Never fall back to the default profile: all three sessions must remain separate.
        WebViewCompat.setProfile(view, "goltou-$session")
        // CDP uses CSS pixels. Android's default density zoom otherwise paints the
        // 1280px desktop layout outside the physical view on high-density phones.
        view.setInitialScale(100)
        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            useWideViewPort = true
            loadWithOverviewMode = true
            setSupportMultipleWindows(false)
            javaScriptCanOpenWindowsAutomatically = false
        }
        view.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val entry = entries[id] ?: return true
                val policy = entry.policy ?: return request.isForMainFrame && request.url.scheme !in setOf("http", "https")
                val url = request.url.toString()
                if (policy.isLanding(url) && request.isForMainFrame) {
                    // Authentication may redirect home; its contents are checked hidden only.
                    if (entry.frame.parent === visible) { setVisible(id, false); onNavigationHidden(id) }
                    return false
                }
                return !policy.allows(url)
            }
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                val policy = entries[id]?.policy ?: return null
                // Also covers main-frame POSTs, which shouldOverrideUrlLoading omits.
                if (request.isForMainFrame && !policy.allows(request.url.toString()) && !policy.isLanding(request.url.toString())) {
                    view.post { entries[id]?.let { if (it.frame.parent === visible) setVisible(id, false); it.view.loadUrl(policy.fallbackUrl) } }
                    return WebResourceResponse("text/plain", "UTF-8", ByteArrayInputStream(ByteArray(0)))
                }
                return null
            }
            override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                val entry = entries[id] ?: return
                // Target discovery can precede this callback on the first profile load.
                // The initial hidden marker must not cancel the first real navigation.
                if (url == entry.bootstrapUrl && entry.frame.parent !== visible) return
                entry.loadedUrl = null; entry.loadFailed = false
                val policy = entry.policy ?: return
                if (policy.isLanding(url)) { if (entry.frame.parent === visible) { setVisible(id, false); onNavigationHidden(id) } }
                else if (!policy.allows(url)) {
                    if (entry.frame.parent === visible) setVisible(id, false)
                    view.stopLoading(); view.loadUrl(policy.fallbackUrl)
                }
            }
            override fun onPageFinished(view: WebView, url: String) { entries[id]?.let { if (!it.loadFailed) it.loadedUrl = url } }
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) entries[id]?.let { it.loadFailed = true; it.loadedUrl = null; if (it.frame.parent === visible) setVisible(id, false) }
            }
            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
                if (request.isForMainFrame) entries[id]?.let { it.loadFailed = true; it.loadedUrl = null; if (it.frame.parent === visible) setVisible(id, false) }
            }
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                destroy(id)
                return true
            }
        }
        // Page dialogs remain user-controlled when shown; no automatic confirmations.
        view.webChromeClient = object : WebChromeClient() {
            override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean = false
            override fun onConsoleMessage(message: ConsoleMessage): Boolean =
                !BuildConfig.DEBUG || super.onConsoleMessage(message)
            private fun forward(kind: String, url: String, message: String, result: JsResult): Boolean {
                val entry = entries[id] ?: return false
                if (entry.policy != null) return false // The real login page owns its visible alerts/consent.
                check(entry.dialog == null) { "DIALOG_ALREADY_PENDING" }
                // Hold the JS result for an explicit choice in the app UI. No automatic default.
                entry.dialog = PendingDialog((++dialogSerial).toString(), kind, message, url, result)
                return true
            }
            override fun onJsAlert(view: WebView, url: String, message: String, result: JsResult) = forward("alert", url, message, result)
            override fun onJsConfirm(view: WebView, url: String, message: String, result: JsResult) = forward("confirm", url, message, result)
        }
        view.isFocusable = false
        view.isFocusableInTouchMode = false
        val bootstrapUrl = "about:blank#${Uri.encode(msg.getString("marker"))}"
        val entry = Entry(view, session, view, bootstrapUrl)
        entries[id] = entry
        hidden.addView(view, FrameLayout.LayoutParams(1280, 900))
        view.loadUrl(bootstrapUrl)
    }

    private fun setVisible(id: String, show: Boolean) {
        val entry = entries[id] ?: error("NO_SURFACE")
        if (show) check(entry.policy != null) { "ONLY_LOGIN_SURFACE_VISIBLE" }
        if (show && entry.policy != null) check(!entry.loadFailed && entry.loadedUrl == entry.view.url &&
            entry.loadedUrl?.let { entry.policy!!.allows(it) } == true) { "LOGIN_PAGE_NOT_READY" }
        (entry.frame.parent as? ViewGroup)?.removeView(entry.frame)
        (entry.view.parent as? ViewGroup)?.removeView(entry.view)
        entry.view.isFocusable = show
        entry.view.isFocusableInTouchMode = show
        if (show) {
            val column = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.WHITE) }
            column.addView(Button(context).apply {
                text = "골투오토로 돌아가기"; setTextColor(Color.rgb(15, 81, 50)); setBackgroundColor(Color.WHITE)
                stateListAnimator = null; elevation = 0f
                minHeight = (48 * context.resources.displayMetrics.density).toInt()
                setOnClickListener { setVisible(id, false); onUserHidden(id) }
            })
            column.addView(entry.view, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
            entry.frame = column
            visible.addView(column, FrameLayout.LayoutParams(-1, -1))
            visible.visibility = View.VISIBLE
            entry.view.requestFocus()
        } else {
            entry.frame = entry.view
            entry.view.clearFocus()
            hidden.addView(entry.view, FrameLayout.LayoutParams(1280, 900))
        }
        if (visible.childCount == 0) visible.visibility = View.GONE
    }

    fun hideTop(): Boolean {
        val id = entries.entries.lastOrNull { it.value.frame.parent === visible }?.key ?: return false
        setVisible(id, false)
        onUserHidden(id)
        return true
    }
    private fun destroy(id: String) {
        val entry = entries.remove(id) ?: return
        (entry.frame.parent as? ViewGroup)?.removeView(entry.frame)
        (entry.view.parent as? ViewGroup)?.removeView(entry.view)
        entry.view.stopLoading()
        entry.view.destroy()
        if (visible.childCount == 0) visible.visibility = View.GONE
    }
    fun close() = entries.keys.toList().forEach { destroy(it) }
}
