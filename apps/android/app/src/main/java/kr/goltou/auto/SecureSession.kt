package kr.goltou.auto

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Only an AES-GCM ciphertext and IV persist. The non-exportable key stays in Keystore. */
class SecureSession(context: Context) {
    private val preferences = context.getSharedPreferences("goltou-session", Context.MODE_PRIVATE)
    private val alias = "goltou-session-v1"
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    fun handle(op: String, message: JSONObject, reply: (JSONObject?, String?) -> Unit) {
        when (op) {
            "session.device" -> reply(JSONObject().put("kind", "android").put("model", Build.MODEL).put("appVersion", BuildConfig.VERSION_NAME), null)
            "session.read" -> {
                val token = try {
                    preferences.getString("ciphertext", null)?.let { value ->
                        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(preferences.getString("iv", null), Base64.NO_WRAP)))
                        val plain = cipher.doFinal(Base64.decode(value, Base64.NO_WRAP))
                        try { String(plain, Charsets.UTF_8) } finally { plain.fill(0) }
                    }
                } catch (_: Exception) { check(preferences.edit().clear().commit()); null }
                reply(JSONObject().put("token", token ?: JSONObject.NULL), null)
            }
            "session.write" -> {
                if (message.isNull("token")) check(preferences.edit().clear().commit())
                else {
                    val plain = message.getString("token").toByteArray(Charsets.UTF_8)
                    try {
                        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
                        val encrypted = cipher.doFinal(plain)
                        check(preferences.edit().putString("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
                            .putString("ciphertext", Base64.encodeToString(encrypted, Base64.NO_WRAP)).commit())
                    } finally { plain.fill(0); message.remove("token") }
                }
                reply(JSONObject(), null)
            }
            else -> error("UNKNOWN_SESSION_OP")
        }
    }
}
