package kr.goltou.auto

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UiPhotoPolicyTest {
    @Test fun allowsOnlyPublicGoltouHttps() {
        listOf("https://goltou.kr/a.jpg", "https://images.goltou.kr/a.jpg", "https://cdn.images.goltou.kr/a.jpg", "https://GOLTOU.KR:443/a.jpg")
            .forEach { assertTrue(it, UiPhotoPolicy.allows(it)) }
    }

    @Test fun rejectsOtherHostsCredentialsAndPorts() {
        listOf("http://images.goltou.kr/a.jpg", "https://goltou.kr.evil.test/a.jpg", "https://notgoltou.kr/a.jpg", "https://goltou.kr:8443/a.jpg", "https://name@goltou.kr/a.jpg", "https://goltou.kr@evil.test/a.jpg", "data:image/png,abc", "/a.jpg", "")
            .forEach { assertFalse(it, UiPhotoPolicy.allows(it)) }
    }
}
