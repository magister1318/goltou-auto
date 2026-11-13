// Reference: ../refs/DAF/daf3/apps/mobile/android/app/src/main/java/com/daehanaifactory/dafmobile/DevtoolsRelay.kt
package kr.goltou.auto

import android.net.LocalServerSocket
import android.net.LocalSocket
import android.net.LocalSocketAddress
import android.os.Process
import android.util.Log
import java.io.File
import java.io.InputStream
import java.io.OutputStream

/**
 * Relays a filesystem socket in the app's private directory to the WebView DevTools socket
 * (`@webview_devtools_remote_<pid>`, abstract namespace), which Node 18 cannot dial directly.
 * The file lives under filesDir, so only this app's uid can connect.
 */
class DevtoolsRelay private constructor(val socketFile: File) {
    companion object {
        @Volatile private var instance: DevtoolsRelay? = null

        /** One relay per process (the socket file is bound once). */
        @Synchronized
        fun get(filesDir: File): DevtoolsRelay = instance ?: DevtoolsRelay(File(filesDir, "devtools.sock")).also { it.start(); instance = it }
    }

    @Volatile private var running = false
    // Both stay referenced for the process lifetime: if `bound` were collected, its finalizer would
    // close the descriptor under the server socket (accept then fails with EBADF).
    private var bound: LocalSocket? = null
    private var server: LocalServerSocket? = null

    private fun open(): LocalServerSocket {
        try { server?.close() } catch (_: Exception) {}
        try { bound?.close() } catch (_: Exception) {}
        socketFile.delete()
        val socket = LocalSocket()
        socket.bind(LocalSocketAddress(socketFile.absolutePath, LocalSocketAddress.Namespace.FILESYSTEM))
        bound = socket
        return LocalServerSocket(socket.fileDescriptor).also { server = it }
    }

    private fun start() {
        if (running) return
        running = true
        var listener = open()
        Thread({
            var failures = 0
            while (running) {
                val client = try {
                    listener.accept().also { failures = 0 }
                } catch (e: Exception) {
                    // Never spin: back off, then bind a fresh socket.
                    failures++
                    Log.w("GOLTOU", "RELAY_ACCEPT_FAILED")
                    Thread.sleep(minOf(5_000L, 200L * failures))
                    listener = try { open() } catch (_: Exception) { Log.w("GOLTOU", "RELAY_REOPEN_FAILED"); listener }
                    continue
                }
                Thread({ bridge(client) }, "goltou-devtools-conn").start()
            }
        }, "goltou-devtools-relay").start()
    }

    private fun bridge(client: LocalSocket) {
        val upstream = LocalSocket()
        try {
            upstream.connect(LocalSocketAddress("webview_devtools_remote_${Process.myPid()}", LocalSocketAddress.Namespace.ABSTRACT))
        } catch (e: Exception) {
            Log.w("GOLTOU", "DEVTOOLS_CONNECT_FAILED")
            client.close()
            return
        }
        val a = Thread({ pump(client.inputStream, upstream.outputStream); close(client, upstream) }, "goltou-devtools-up")
        val b = Thread({ pump(upstream.inputStream, client.outputStream); close(client, upstream) }, "goltou-devtools-down")
        a.start(); b.start()
    }

    private fun pump(input: InputStream, output: OutputStream) {
        val buf = ByteArray(64 * 1024)
        try {
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                output.write(buf, 0, n)
                output.flush()
            }
        } catch (_: Exception) {
        }
    }

    private fun close(vararg sockets: LocalSocket) {
        for (s in sockets) try { s.close() } catch (_: Exception) {}
    }
}
