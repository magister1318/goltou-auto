package kr.goltou.auto

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NavigationPolicyTest {
    private val policy = NavigationPolicy(listOf(NavigationRoute("nid.naver.com", "/nidlogin.login"),
        NavigationRoute("nid.naver.com", "/login/", true)), listOf(NavigationRoute("m.blog.naver.com", "/")),
        "https://nid.naver.com/nidlogin.login")
    @Test fun permitsAuthenticationAndSeparatesHiddenLanding() {
        assertTrue(policy.allows("https://nid.naver.com/nidlogin.login?url=https%3A%2F%2Fm.blog.naver.com%2F"))
        assertTrue(policy.allows("https://nid.naver.com/login/ext/deviceConfirm.nhn"))
        assertTrue(policy.isLanding("https://m.blog.naver.com/"))
        assertFalse(policy.allows("https://m.blog.naver.com/"))
    }
    @Test fun rejectsEditorsFeedsLogoutAndHostSpoofing() {
        listOf("about:blank", "https://nid.naver.com.evil.test/nidlogin.login", "http://nid.naver.com/nidlogin.login",
            "https://name@nid.naver.com/nidlogin.login", "https://nid.naver.com:8443/nidlogin.login",
            "https://nid.naver.com/nidlogin.logout", "https://blog.naver.com/GoBlogWrite.naver",
            "https://band.us/feed", "intent://band.us/", "market://details", "https://nid.naver.com/login%2Fext/x")
            .forEach { assertFalse(it, policy.allows(it)); assertFalse(it, policy.isLanding(it)) }
    }
}
