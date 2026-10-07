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
        val size =
            resolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use {
                if (it.moveToFirst() && !it.isNull(0)) it.getLong(0) else null
            }
        return Picked(resolver.getType(uri) ?: OCTET_STREAM, size) {
            outgoing.mkdirs()
            val file = File.createTempFile("picked", null, outgoing)
            val input = resolver.openInputStream(uri) ?: throw IOException("no stream for the picked file")
            input.use { from -> file.outputStream().use { from.copyTo(it) } }
            file
        }
    }

    /** A chooser that opens the file at [path] in another app, read-only. */
    fun opener(
        path: String,
        mime: String,
    ): Intent {
        shared.mkdirs()
        val extension = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime)?.let { ".$it" } ?: ""
        val copy = File(shared, File(path).nameWithoutExtension + extension)
        File(path).copyTo(copy, overwrite = true)
        val uri = FileProvider.getUriForFile(context, "${context.packageName}$AUTHORITY", copy)
        val view =
            Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, mime)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        return Intent.createChooser(view, null)
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
