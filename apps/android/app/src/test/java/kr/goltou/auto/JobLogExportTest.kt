package kr.goltou.auto

import java.io.File
import java.nio.file.Files
import java.util.zip.ZipFile
import org.junit.Assert.*
import org.junit.Test

class JobLogExportTest {
    @Test fun exportsOnlyJobFilesAndIndexWithoutSaltOrUnrelatedFiles() {
        val root = Files.createTempDirectory("job-log-export").toFile()
        try {
            val logs = File(root, "logs").apply { mkdirs() }
            File(logs, ".salt").writeText("PRIVATE_SALT")
            File(logs, "session.json").writeText("PRIVATE_SESSION")
            File(logs, "index.json").writeText("[]")
            val day = File(logs, "20261117").apply { mkdirs() }
            val name = "1794839998000-band_post-12345678-1234-1234-1234-123456789abc.jsonl"
            File(day, name).writeText("{\"event\":\"start\"}\n")
            val zip = JobLogExport.archive(logs, File(root, "cache"))
            ZipFile(zip).use { archive ->
                val names = archive.entries().asSequence().map { it.name }.toList()
                assertEquals(setOf("index.json", "20261117/$name"), names.toSet())
                assertFalse(names.any { it.contains("salt") || it.contains("session") })
            }
        } finally { root.deleteRecursively() }
    }
}
