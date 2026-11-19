package kr.goltou.auto

import java.io.File
import java.security.MessageDigest

class UpdateFailure(val reason: String) : Exception(reason)
data class UpdateArchive(val packageName: String, val code: Long, val signers: Set<String>)

/** JVM-testable gate used by the actual installer path. Every rejection removes the candidate. */
object UpdateVerification {
    fun sha256(file: File, cancelled: () -> Boolean = { false }): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                if (cancelled()) throw UpdateFailure("UPDATE_CANCELLED")
                val count = input.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
        return hex(digest.digest())
    }
    fun certificate(bytes: ByteArray) = hex(MessageDigest.getInstance("SHA-256").digest(bytes))
    private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it) }

    fun verify(file: File, hash: String, installedCode: Long, installedSigners: Set<String>,
               archive: () -> UpdateArchive?, cancelled: () -> Boolean = { false },
               log: (String, String?) -> Unit = { _, _ -> }) {
        var step = "verify_hash"
        try {
            if (!sha256(file, cancelled).equals(hash, ignoreCase = true)) throw UpdateFailure("UPDATE_HASH_MISMATCH")
            log(step, null)
            step = "verify_package"
            val info = archive() ?: throw UpdateFailure("UPDATE_PACKAGE_MISMATCH")
            if (info.packageName != "kr.goltou.auto") throw UpdateFailure("UPDATE_PACKAGE_MISMATCH")
            log(step, null)
            step = "verify_version"
            if (info.code <= installedCode) throw UpdateFailure("UPDATE_NOT_NEWER")
            log(step, null)
            step = "verify_signer"
            if (info.signers.isEmpty() || installedSigners.isEmpty() || info.signers != installedSigners)
                throw UpdateFailure("UPDATE_SIGNER_MISMATCH")
            log(step, null)
            if (cancelled()) throw UpdateFailure("UPDATE_CANCELLED")
        } catch (e: Exception) {
            file.delete()
            val reason = (e as? UpdateFailure)?.reason ?: "UPDATE_PACKAGE_MISMATCH"
            log(step, reason)
            throw UpdateFailure(reason)
        }
    }
}
