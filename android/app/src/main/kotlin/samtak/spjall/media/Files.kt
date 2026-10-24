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
    private val camera get() = File(context.cacheDir, CAMERA)

    /** Where the system camera writes the next photo, as a uri it may write to (decision 0047). */
    fun cameraTarget(): Uri {
        camera.deleteRecursively()
        camera.mkdirs()
        return FileProvider.getUriForFile(context, "${context.packageName}$AUTHORITY", File(camera, TAKEN))
    }

    /**
     * The photo the camera wrote to [cameraTarget], without where it was taken (0047), moved to
     * the outgoing folder for the core to seal. Null when the camera wrote nothing.
     */
    fun taken(): Picked? {
        val file = File(camera, TAKEN).takeIf { it.length() > 0 } ?: return null
        stripLocation(file.path)
        outgoing.mkdirs()
        val moved = File.createTempFile("taken", ".jpg", outgoing)
        if (!file.renameTo(moved)) {
            file.copyTo(moved, overwrite = true)
            file.delete()
        }
        return Picked(JPEG, moved.length()) { moved }
    }

    /**
     * A photo picked through "Mynd", without where it was taken (0048), in
     * the formats that can lose it without being encoded again; [picked]
     * keeps a file sent through "Skrá" as it is, byte for byte.
     */
    fun pickedPhoto(uri: Uri): Picked {
        val picked = picked(uri)
        return Picked(picked.mime, picked.size, picked.name) {
            picked.read().also { stripLocation(it.path, picked.mime) }
        }
    }

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
     * The picked photo at [uri] as a master for a profile photo, a community picture or a cover (decisions 0039,
     * 0080 and 0086): upright, no more than 2400 pixels on its long side, in a file the caller deletes once it is
     * sent. The person's crop is a framing set after it, never a cut of it. The copy read from the picker goes at once.
     */
    fun master(uri: Uri): File {
        val copy = picked(uri).read()
        try {
            outgoing.mkdirs()
            val out = File.createTempFile("photo", ".jpg", outgoing)
            if (!masterPhoto(copy.path, out)) {
                out.delete()
                throw IOException("the picked file is not an image")
            }
            return out
        } finally {
            copy.delete()
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
        camera.deleteRecursively()
    }

    private companion object {
        const val OUTGOING = "outgoing"
        const val SHARED = "shared"
        const val CAMERA = "camera"
        const val TAKEN = "taken.jpg"
        const val JPEG = "image/jpeg"
        const val AUTHORITY = ".files"
        const val OCTET_STREAM = "application/octet-stream"

        // Twice the server's 512 px, so its re-encode still has detail to scale down from.
    }
}
