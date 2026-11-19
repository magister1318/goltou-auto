package kr.goltou.auto

import java.net.URI

/** Host/path only; never log queries, fragments, exceptions or page content. */
object ConnectionDiagnostics {
    enum class Step { CREATED, STARTED, FINISHED, BLOCKED, NET_ERROR, HTTP_ERROR, SHOWN, HIDDEN, RENDERER_GONE,
        POPUP_OPENED, POPUP_CLOSED, LANDING_HIDDEN, BLOCKED_HIDDEN, CHECK_CONFIRMED, CHECK_NOT_CONFIRMED, RETRY_LIMIT }
    data class Metadata(val host: String, val path: String)
    fun metadata(url: String?): Metadata {
        val uri = try { url?.let { URI(it) } } catch (_: Exception) { null }
        return Metadata(uri?.host?.lowercase() ?: "none", uri?.rawPath?.takeIf { it.startsWith("/") }
            ?.replace(Regex("[\\r\\n\\t ]"), "_")?.replace(Regex("[0-9]{3,}"), "{n}")?.take(80) ?: "none")
    }
    fun line(session: String, step: Step, url: String? = null, code: Int? = null): String {
        val service = if (session in setOf("naver", "band", "ai")) session else "other"
        val (host, path) = metadata(url)
        val status = code?.takeIf { it in -999..599 }?.toString() ?: "none"
        return "CONNECTION_${step.name} service=$service host=$host path=$path code=$status"
    }
}
