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
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import androidx.webkit.ProfileStore
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import androidx.webkit.WebStorageCompat
import org.json.JSONObject

class SurfaceHost(private val context: Context, private val hidden: FrameLayout, private val visible: FrameLayout) {
    private data class Entry(val view: WebView, val session: String, var frame: View)
    private val entries = mutableMapOf<String, Entry>()
    private val sessions = setOf("naver", "band", "ai")
    private val clearing = mutableSetOf<String>()

    fun handle(op: String, msg: JSONObject, reply: (JSONObject?, String?) -> Unit) {
        when (op) {
            "surface.create" -> create(msg)
            "surface.destroy" -> destroy(msg.getString("surface"))
            "surface.visible" -> setVisible(msg.getString("surface"), msg.getBoolean("visible"))
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
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                request.isForMainFrame && request.url.scheme !in setOf("http", "https")
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                destroy(id)
                return true
            }
        }
        // Page dialogs remain user-controlled when shown; no automatic confirmations.
        view.webChromeClient = WebChromeClient()
        view.isFocusable = false
        view.isFocusableInTouchMode = false
        val entry = Entry(view, session, view)
        entries[id] = entry
        hidden.addView(view, FrameLayout.LayoutParams(1280, 900))
        view.loadUrl("about:blank#${Uri.encode(msg.getString("marker"))}")
    }

    private fun setVisible(id: String, show: Boolean) {
        val entry = entries[id] ?: error("NO_SURFACE")
        (entry.frame.parent as? ViewGroup)?.removeView(entry.frame)
        (entry.view.parent as? ViewGroup)?.removeView(entry.view)
        entry.view.isFocusable = show
        entry.view.isFocusableInTouchMode = show
        if (show) {
            val column = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.WHITE) }
            column.addView(Button(context).apply { text = "진단 화면으로 돌아가기"; setOnClickListener { setVisible(id, false) } })
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
