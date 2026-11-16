package kr.goltou.auto

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import androidx.core.content.FileProvider
import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/** Explicit local export only. Never includes the private correlation salt or session files. */
object JobLogExport {
    fun archive(sourceDirectory: File, cacheDirectory: File): File {
        val source = sourceDirectory.canonicalFile
        val cache = cacheDirectory.apply { mkdirs() }.canonicalFile
        cache.listFiles()?.filter { it.isFile && it.name.matches(Regex("job-logs-[0-9]+\\.zip")) }?.forEach { it.delete() }
        val zip = File(cache, "job-logs-${System.currentTimeMillis()}.zip")
        try {
            ZipOutputStream(zip.outputStream().buffered()).use { output ->
                source.walkTopDown().filter { file ->
                    file.isFile && file.canonicalPath.startsWith(source.path + File.separator) &&
                        (file.name == "index.json" || file.name.matches(Regex("[0-9]+-[a-z_]+-[a-f0-9-]{36}\\.jsonl")))
                }.sortedBy { it.path }.forEach { file ->
                    val entry = file.relativeTo(source).invariantSeparatorsPath
                    output.putNextEntry(ZipEntry(entry))
                    file.inputStream().use { it.copyTo(output) }
                    output.closeEntry()
                }
            }
            return zip
        } catch (error: Exception) { zip.delete(); throw error }
    }

    fun share(activity: Activity, zip: File) {
            val uri = FileProvider.getUriForFile(activity, "${BuildConfig.APPLICATION_ID}.joblogs", zip)
            val intent = Intent(Intent.ACTION_SEND).apply {
                type = "application/zip"
                putExtra(Intent.EXTRA_STREAM, uri)
                clipData = ClipData.newUri(activity.contentResolver, "작업 로그", uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity.startActivity(Intent.createChooser(intent, "작업 로그 내보내기"))
    }
}
