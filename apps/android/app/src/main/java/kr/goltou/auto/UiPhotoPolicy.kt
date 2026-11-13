package kr.goltou.auto

import java.net.URI
import java.util.Locale

/** Matches core/photo-url.ts. Navigation and other external assets stay blocked. */
internal object UiPhotoPolicy {
    fun allows(value: String): Boolean = try {
        val uri = URI(value)
        val host = uri.host?.lowercase(Locale.ROOT).orEmpty()
        uri.scheme.equals("https", ignoreCase = true) && uri.rawUserInfo == null &&
            (uri.port == -1 || uri.port == 443) &&
            (host == "goltou.kr" || host.endsWith(".goltou.kr"))
    } catch (_: Exception) { false }
}
