package kr.goltou.auto

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class ConnectionDiagnosticsTest {
    @Test fun retainsKnownRouteAndNumericFailureWithoutQueryOrFragment() {
        assertEquals("CONNECTION_NET_ERROR service=band host=www.band.us path=/about/kr/intro code=-2",
            ConnectionDiagnostics.line("band", ConnectionDiagnostics.Step.NET_ERROR,
                "https://www.band.us/about/kr/intro?token=PRIVATE#PRIVATE", -2))
    }
    @Test fun retainsUnknownHostAndMasksDigitsWithoutQueryOrFragment() {
        val line = ConnectionDiagnostics.line("invalid", ConnectionDiagnostics.Step.BLOCKED_HIDDEN,
            "https://unknown.example/step/123456/12?token=PRIVATE#PRIVATE", Int.MAX_VALUE)
        assertEquals("CONNECTION_BLOCKED_HIDDEN service=other host=unknown.example path=/step/{n}/12 code=none", line)
        assertFalse(line.contains("PRIVATE"))
        assertEquals(80, ConnectionDiagnostics.metadata("https://unknown.example/" + "a".repeat(100)).path.length)
        assertEquals("none", ConnectionDiagnostics.metadata("invalid PRIVATE").host)
    }
    @Test fun landingIsHiddenForEveryPath() {
        val policy = NavigationPolicy(listOf(NavigationRoute("auth.band.us", "/", true)),
            listOf(NavigationRoute("www.band.us", "/", true)), "https://auth.band.us/login")
        assertEquals(true, policy.isLanding("https://www.band.us/about/kr/intro"))
        assertFalse(policy.allows("https://www.band.us/about/kr/intro"))
        assertEquals(true, policy.isLanding("https://www.band.us/about/kr/intro/other"))
        assertEquals(true, policy.isLanding("https://www.band.us/next"))
        assertFalse(policy.allows("https://www.band.us/next"))
    }
}
