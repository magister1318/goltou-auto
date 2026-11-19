package kr.goltou.auto

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NavigationPolicyTest {
    private val policy = NavigationPolicy(listOf(NavigationRoute("nid.naver.com", "/", true)),
        listOf("m.blog.naver.com", "blog.naver.com", "m.naver.com", "www.naver.com", "naver.com").map { NavigationRoute(it, "/", true) },
        "https://nid.naver.com/nidlogin.login")
    @Test fun permitsAuthenticationAndSeparatesHiddenLanding() {
        assertTrue(policy.allows("https://nid.naver.com/nidlogin.login?url=https%3A%2F%2Fm.blog.naver.com%2F"))
        assertTrue(policy.allows("https://nid.naver.com/login/ext/deviceConfirm.nhn"))
        assertTrue(policy.allows("https://nid.naver.com/login/ext/deviceConfirm"))
        assertTrue(policy.allows("https://nid.naver.com"))
        assertTrue(policy.isLanding("https://m.blog.naver.com/"))
        assertFalse(policy.allows("https://m.blog.naver.com/"))
        assertTrue(policy.isLanding("https://m.naver.com/"))
        assertTrue(policy.isLanding("https://blog.naver.com/someid"))
    }
    @Test fun bandPermitsBothAuthHostsAndHidesAllLandingPaths() {
        val band = NavigationPolicy(listOf("auth.band.us", "nid.naver.com").map { NavigationRoute(it, "/", true) },
            listOf("band.us", "www.band.us").map { NavigationRoute(it, "/", true) }, "https://auth.band.us/login")
        assertTrue(band.allows("https://auth.band.us/external_account_login"))
        assertTrue(band.allows("https://nid.naver.com/login/ext/deviceConfirm"))
        assertTrue(band.isLanding("https://band.us/band/123/post"))
        assertFalse(band.allows("https://band.us/band/123/post"))
        assertFalse(band.isLanding("https://foreign.example/"))
        assertFalse(band.allows("https://foreign.example/"))
    }
    @Test fun rejectsForeignHostsAndHostSpoofing() {
        listOf("about:blank", "https://nid.naver.com.evil.test/nidlogin.login", "http://nid.naver.com/nidlogin.login",
            "https://name@nid.naver.com/nidlogin.login", "https://nid.naver.com:8443/nidlogin.login",
            "https://foreign.example/", "https://band.us/feed", "intent://band.us/", "market://details")
            .forEach { assertFalse(it, policy.allows(it)); assertFalse(it, policy.isLanding(it)) }
    }
}
