package kr.goltou.auto

import java.net.URI

/** URL metadata only. Never inspect requests, form bodies, credentials or cookies. */
data class NavigationRoute(val hostname: String, val pathname: String, val prefix: Boolean = false)
data class NavigationPolicy(val allowed: List<NavigationRoute>, val landing: List<NavigationRoute>, val fallbackUrl: String) {
    fun allows(url: String) = matches(url, allowed)
    fun isLanding(url: String) = matches(url, landing)
    private fun matches(url: String, routes: List<NavigationRoute>): Boolean = try {
        val uri = URI(url)
        uri.scheme == "https" && uri.rawUserInfo == null && (uri.port == -1 || uri.port == 443) &&
            routes.any { uri.host.equals(it.hostname, ignoreCase = true) &&
                if (it.prefix) uri.rawPath.startsWith(it.pathname) else uri.rawPath == it.pathname }
    } catch (_: Exception) { false }
}
