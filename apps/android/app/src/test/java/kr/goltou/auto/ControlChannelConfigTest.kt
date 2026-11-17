package kr.goltou.auto

import org.junit.Assert.*
import org.junit.Test

/** Runs against each variant's generated BuildConfig, including testReleaseUnitTest. */
class ControlChannelConfigTest {
    @Test fun controlChannelIsIndependentOfDiagnosticBuild() {
        assertTrue(BuildConfig.WEBVIEW_CONTROL_ENABLED)
        if (BuildConfig.BUILD_TYPE == "release") {
            assertFalse(BuildConfig.DEBUG)
            assertEquals("kr.goltou.auto", BuildConfig.APPLICATION_ID)
        } else {
            assertTrue(BuildConfig.DEBUG)
            assertEquals("kr.goltou.auto", BuildConfig.APPLICATION_ID)
        }
    }
}
