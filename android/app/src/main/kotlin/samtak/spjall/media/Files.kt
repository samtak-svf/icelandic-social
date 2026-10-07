package samtak.spjall.media

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import samtak.spjall.conversation.Picked
import java.io.File
import java.io.IOException

/**
 * Files on their way in and out of the core. A picked file is copied to the
 * cache for the core to seal, and deleted once it has. A file the person
 * opens is copied to the cache for [FileProvider] to share, since the core's
 * own folder is outside what it can serve; [clear] empties both at start.
 */
class Files(
    private val context: Context,
) {
    private val outgoing get() = File(context.cacheDir, OUTGOING)
    private val shared get() = File(context.cacheDir, SHARED)

    fun picked(uri: Uri): Picked {
        val resolver = context.contentResolver
        val columns = arrayOf(OpenableColumns.SIZE, OpenableColumns.DISPLAY_NAME)
        val (size, name) =
            resolver.query(uri, columns, null, null, null)?.use {
                if (!it.moveToFirst()) return@use null
                (if (it.isNull(0)) null else it.getLong(0)) to (if (it.isNull(1)) null else it.getString(1))
            } ?: (null to null)
        return Picked(resolver.getType(uri) ?: OCTET_STREAM, size, name) {
            outgoing.mkdirs()
            val file = File.createTempFile("picked", null, outgoing)
            val input = resolver.openInputStream(uri) ?: throw IOException("no stream for the picked file")
            input.use { from -> file.outputStream().use { from.copyTo(it) } }
            file
        }
    }

    /**
     * Opens the file at [path] in another app, read-only, as a copy under the
     * sender's [name] when there is one. With no app for its type, starting
     * it throws [android.content.ActivityNotFoundException].
     */
    fun opener(
        path: String,
        mime: String,
        name: String?,
    ): Intent {
        shared.mkdirs()
        val extension = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime)?.let { ".$it" } ?: ""
        // The core cut the name to a bare one (0023); File(...).name keeps it so.
        val named = name?.let { File(it).name }?.takeIf { it.isNotBlank() && it != "." && it != ".." }
        val copy = File(shared, named ?: (File(path).nameWithoutExtension + extension))
        File(path).copyTo(copy, overwrite = true)
        val uri = FileProvider.getUriForFile(context, "${context.packageName}$AUTHORITY", copy)
        return Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, mime)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }

    fun clear() {
        outgoing.deleteRecursively()
        shared.deleteRecursively()
    }

    private companion object {
        const val OUTGOING = "outgoing"
        const val SHARED = "shared"
        const val AUTHORITY = ".files"
        const val OCTET_STREAM = "application/octet-stream"
    }
}
