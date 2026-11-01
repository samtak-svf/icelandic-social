package samtak.spjall.media

import android.graphics.Bitmap
import androidx.core.graphics.scale
import samtak.spjall.frames.ImageSize
import samtak.spjall.limits.Limits
import java.io.ByteArrayOutputStream
import java.io.File

/** The longest edge of a master, in pixels (decision 0086). */
const val MASTER_LONGEST = 2400

/** A master must stay under what the server accepts for an image. */
const val MASTER_LIMIT = Limits.IMAGE_BYTES

/** JPEG qualities tried in turn, from the best down. */
val MASTER_QUALITIES = listOf(90, 80, 70, 60)

/** The size of an image after it is brought down to a master: its long edge at most 2400, never upscaled. */
fun masterSize(
    width: Int,
    height: Int,
): ImageSize {
    val longest = maxOf(width, height)
    if (longest <= MASTER_LONGEST) return ImageSize(width, height)
    val scale = MASTER_LONGEST.toDouble() / longest
    return ImageSize(
        maxOf(1, Math.round(width * scale).toInt()),
        maxOf(1, Math.round(height * scale).toInt()),
    )
}

/** The first JPEG quality whose encoding fits [limit] bytes, else the lowest. */
fun masterQuality(
    limit: Long,
    encodedSize: (Int) -> Long,
): Int = MASTER_QUALITIES.firstOrNull { encodedSize(it) <= limit } ?: MASTER_QUALITIES.last()

/**
 * The photo at [path] as a master written to [out] (decision 0086): upright, its long edge at most
 * [MASTER_LONGEST] pixels, a JPEG under [MASTER_LIMIT] bytes. Only the pixels are written, so none of the original's
 * metadata goes with it. The person's crop is a framing on top of it, never a cut of it. False when [path] is not an
 * image this device can read.
 */
fun masterPhoto(
    path: String,
    out: File,
): Boolean {
    val photo = decodePhoto(path, MASTER_LONGEST) ?: return false
    val size = masterSize(photo.width, photo.height)
    val fitted = if (size.w != photo.width || size.h != photo.height) photo.scale(size.w, size.h) else photo

    fun encode(quality: Int): ByteArray =
        ByteArrayOutputStream().also { fitted.compress(Bitmap.CompressFormat.JPEG, quality, it) }.toByteArray()
    out.writeBytes(encode(masterQuality(MASTER_LIMIT) { encode(it).size.toLong() }))
    return true
}
