package kr.goltou.auto

import java.net.URI

/** Fixed vocabulary only; never log raw URLs, queries, exceptions or page content. */
object ConnectionDiagnostics {
    enum class Step { CREATED, STARTED, FINISHED, BLOCKED, NET_ERROR, HTTP_ERROR, SHOWN, HIDDEN, RENDERER_GONE }
    private val hosts = setOf("band.us", "www.band.us", "auth.band.us", "nid.naver.com", "m.blog.naver.com")
    private val paths = setOf("/", "/about/kr/intro", "/login", "/email_login", "/phone_login", "/nidlogin.login",
        "/user2/help/myInfo", "/user2/help/myInfoV2", "/Recommendation.naver")
    fun line(session: String, step: Step, url: String? = null, code: Int? = null): String {
        val uri = try { url?.let { URI(it) } } catch (_: Exception) { null }
        val service = if (session in setOf("naver", "band", "ai")) session else "other"
        val host = uri?.host?.takeIf { it in hosts } ?: "other"
        val path = uri?.rawPath?.takeIf { host != "other" && it in paths } ?: "other"
        val status = code?.takeIf { it in -999..599 }?.toString() ?: "none"
        return "CONNECTION_${step.name} service=$service host=$host path=$path code=$status"
    }
}
