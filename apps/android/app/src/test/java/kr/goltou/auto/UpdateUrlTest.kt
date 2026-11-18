package kr.goltou.auto

import org.junit.Assert.*
import org.junit.Test

class UpdateUrlTest {
    @Test fun sameApiBaseRelativeRoute() {
        assertEquals("https://example.invalid/api/auto_app/get/synthetic_token-1", AppUpdate.downloadUrl("https://example.invalid/api", "auto_app/get/synthetic_token-1"))
    }
    @Test fun rejectsExternalCredentialsAndTraversal() {
        for (route in listOf("https://evil.invalid/token", "//evil.invalid/token", "../auto_app/get/token", "auto_app/get/token?secret=1", "auto_app/get/%2fsecret")) {
            try { AppUpdate.downloadUrl("https://example.invalid", route); fail("unsafe route") } catch (_: IllegalArgumentException) {}
        }
        for (base in listOf("http://example.invalid", "https://user:password@example.invalid", "https://example.invalid?query=1")) {
            try { AppUpdate.downloadUrl(base, "auto_app/get/token"); fail("unsafe origin") } catch (_: IllegalArgumentException) {}
        }
    }
}
