package kr.goltou.auto

import androidx.activity.result.contract.ActivityResultContracts
import org.json.JSONObject

/** Owner-selected documents only. No WebView data, credentials or broad storage permission. */
class LocalDataDocuments(private val activity: MainActivity, private val session: () -> AppSession) {
    private val create = activity.registerForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        val retained = session()
        if (retained.localDataMode != "export") return@registerForActivityResult
        if (uri == null) finish(null, null)
        else Thread {
            try {
                val text = retained.localDataText ?: error("NO_DATA")
                activity.applicationContext.contentResolver.openOutputStream(uri, "wt")!!.use { it.write(text.toByteArray(Charsets.UTF_8)) }
                finish("", null)
            } catch (_: Exception) { finish(null, "LOCAL_DATA_EXPORT_FAILED") }
        }.start()
    }
    private val open = activity.registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (session().localDataMode != "import") return@registerForActivityResult
        if (uri == null) finish(null, null)
        else Thread {
            try {
                val buffer = ByteArray(512 * 1024 + 1)
                val count = activity.applicationContext.contentResolver.openInputStream(uri)!!.use { input ->
                    var count = 0
                    while (count < buffer.size) {
                        val read = input.read(buffer, count, buffer.size - count)
                        if (read < 0) break
                        if (read == 0) continue
                        count += read
                    }
                    count
                }
                check(count <= 512 * 1024)
                val bytes = buffer.copyOf(count)
                finish(bytes.toString(Charsets.UTF_8), null)
            } catch (_: Exception) { finish(null, "LOCAL_DATA_IMPORT_FAILED") }
        }.start()
    }
    fun start(mode: String, text: String?, reply: (JSONObject?, String?) -> Unit) {
        val retained = session()
        if (retained.localDataReply != null) { reply(null, "LOCAL_DATA_BUSY"); return }
        check(mode == "export" || mode == "import")
        check(mode != "export" || text != null && text.toByteArray(Charsets.UTF_8).size <= 512 * 1024)
        retained.localDataReply = reply
        retained.localDataText = text
        retained.localDataMode = mode
        try {
            if (mode == "export") create.launch("goltou-auto-local-data.json")
            else open.launch(arrayOf("application/json", "text/plain", "application/octet-stream"))
        } catch (_: Exception) { finish(null, "LOCAL_DATA_PICKER_FAILED") }
    }
    private fun finish(text: String?, error: String?) {
        val retained = session()
        val reply = retained.localDataReply
        retained.localDataReply = null; retained.localDataText = null; retained.localDataMode = null
        reply?.invoke(if (error == null) JSONObject().put("text", text ?: JSONObject.NULL) else null, error)
    }
}
