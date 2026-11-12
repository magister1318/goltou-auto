// Reference: ../refs/DAF/daf3/apps/mobile/android/app/src/main/java/com/daehanaifactory/dafmobile/CoreLink.kt
package kr.goltou.auto

import android.os.Handler
import android.os.Looper
import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** The shell's side of the `/native` channel: the core asks, the shell does it on the main thread. */
class CoreLink(private val handler: (String, JSONObject, (JSONObject?, String?) -> Unit) -> Unit) {
    private val main = Handler(Looper.getMainLooper())
    private val client = OkHttpClient.Builder().readTimeout(0, TimeUnit.MILLISECONDS).build()
    private var socket: WebSocket? = null
    @Volatile private var closed = false

    /** Connects once; later calls (a new activity) keep the open link. */
    fun connect() {
        if (closed || socket != null) return
        open()
    }

    private fun open() {
        if (closed) return
        val req = Request.Builder().url("ws://127.0.0.1:${NodeRuntime.port}/native?token=${NodeRuntime.token}").build()
        socket = client.newWebSocket(req, object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                val msg = JSONObject(text)
                val id = msg.getInt("id")
                main.post {
                    try {
                        handler(msg.getString("op"), msg) { result, error ->
                            val out = JSONObject().put("id", id).put("ok", error == null)
                            if (error != null) out.put("error", error) else out.put("result", result ?: JSONObject())
                            webSocket.send(out.toString())
                        }
                    } catch (e: Exception) {
                        Log.w("GOLTOU", "native op failed", e)
                        webSocket.send(JSONObject().put("id", id).put("ok", false).put("error", e.message ?: "NATIVE_ERROR").toString())
                    }
                }
            }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = retry()
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = retry()
        })
    }

    fun event(name: String, data: JSONObject) {
        socket?.send(JSONObject().put("event", name).put("data", data).toString())
    }

    private fun retry() {
        socket = null
        if (!closed) main.postDelayed({ if (socket == null) open() }, 500)
    }

    fun close() {
        closed = true
        socket?.close(1000, null)
    }
}
