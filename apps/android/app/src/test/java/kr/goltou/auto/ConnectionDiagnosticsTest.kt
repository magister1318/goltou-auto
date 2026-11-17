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
    @Test fun dropsUnknownHostPathSessionAndOutOfRangeCode() {
        listOf("https://PRIVATE.example/PRIVATE?token=PRIVATE", "https://band.us/PRIVATE", "invalid PRIVATE").forEach {
            val line = ConnectionDiagnostics.line("PRIVATE", ConnectionDiagnostics.Step.BLOCKED, it, Int.MAX_VALUE)
            assertFalse(line, line.contains("PRIVATE"))
            assertFalse(line, line.contains("2147483647"))
        }
    }
    @Test fun introIsHiddenLandingAndEditorsRemainBlocked() {
        val policy = NavigationPolicy(listOf(NavigationRoute("auth.band.us", "/login")),
            listOf(NavigationRoute("www.band.us", "/about/kr/intro")), "https://auth.band.us/login")
        assertEquals(true, policy.isLanding("https://www.band.us/about/kr/intro"))
        assertFalse(policy.allows("https://www.band.us/about/kr/intro"))
        assertFalse(policy.isLanding("https://www.band.us/about/kr/intro/other"))
        assertFalse(policy.isLanding("https://www.band.us/band/111/post"))
    }
}
