package kr.goltou.auto

import org.junit.Assert.*
import org.junit.Test
import java.io.File

class UpdateVerificationTest {
    private fun candidate() = File.createTempFile("goltou-update-", ".apk").apply { writeText("synthetic-apk") }
    private val good = UpdateArchive("kr.goltou.auto", 9, setOf("same-signer"))
    @Test fun sha256MatchesKnownVector() {
        val file = candidate()
        try {
            file.writeText("abc")
            val expected = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
            assertEquals(expected, UpdateVerification.sha256(file))
            assertEquals(expected, UpdateVerification.certificate("abc".toByteArray()))
        } finally { file.delete() }
    }
    private fun reject(reason: String, hash: String? = null, archive: UpdateArchive? = good) {
        val file = candidate()
        var installerOpened = false
        val events = mutableListOf<Pair<String, String?>>()
        try {
            UpdateVerification.verify(file, hash ?: UpdateVerification.sha256(file), 8, setOf("same-signer"), { archive }, log = { step, code -> events.add(step to code) })
            installerOpened = true
            fail("verification should block")
        } catch (e: UpdateFailure) { assertEquals(reason, e.reason) }
        finally { assertFalse(file.exists()); assertFalse(installerOpened); file.delete() }
        assertEquals(reason, events.last().second)
    }
    @Test fun hashMismatchDeletesAndBlocks() = reject("UPDATE_HASH_MISMATCH", "0".repeat(64))
    @Test fun packageMismatchDeletesAndBlocks() = reject("UPDATE_PACKAGE_MISMATCH", archive = good.copy(packageName = "other.app"))
    @Test fun unreadableArchiveDeletesAndBlocks() = reject("UPDATE_PACKAGE_MISMATCH", archive = null)
    @Test fun equalVersionDeletesAndBlocks() = reject("UPDATE_NOT_NEWER", archive = good.copy(code = 8))
    @Test fun olderVersionDeletesAndBlocks() = reject("UPDATE_NOT_NEWER", archive = good.copy(code = 7))
    @Test fun signerMismatchDeletesAndBlocks() = reject("UPDATE_SIGNER_MISMATCH", archive = good.copy(signers = setOf("other-signer")))
    @Test fun emptySignerSetDeletesAndBlocks() = reject("UPDATE_SIGNER_MISMATCH", archive = good.copy(signers = emptySet()))
    @Test fun extraSignerDeletesAndBlocks() = reject("UPDATE_SIGNER_MISMATCH", archive = good.copy(signers = setOf("same-signer", "extra")))
    @Test fun validCandidateRetainedWithAllSteps() {
        val file = candidate(); val steps = mutableListOf<String>()
        try {
            UpdateVerification.verify(file, UpdateVerification.sha256(file).uppercase(), 8, good.signers, { good }, log = { step, code -> assertNull(code); steps.add(step) })
            assertTrue(file.exists())
            assertEquals(listOf("verify_hash", "verify_package", "verify_version", "verify_signer"), steps)
        } finally { file.delete() }
    }
    @Test fun cancelDuringHashDeletesAndBlocks() {
        val file = candidate()
        try {
            UpdateVerification.verify(file, "0".repeat(64), 8, good.signers, { good }, { true })
            fail("cancel should block")
        } catch (e: UpdateFailure) { assertEquals("UPDATE_CANCELLED", e.reason); assertFalse(file.exists()) }
        finally { file.delete() }
    }
}
