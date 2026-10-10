package samtak.spjall.media

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import androidx.core.graphics.scale
import androidx.exifinterface.media.ExifInterface
import java.io.File
import java.io.IOException

/**
 * The photo at [path], no more than about [longest] pixels on its long side
 * and turned upright. Decoded here rather than by an image library, so no
 * second cache ever holds a decrypted photo.
 */
fun decodePhoto(
    path: String,
    longest: Int,
): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(path, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= longest) sample *= 2
    val bitmap = BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sample })
    val degrees = bitmap?.let { rotation(path) } ?: 0f
    return if (bitmap == null || degrees == 0f) {
        bitmap
    } else {
        Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, Matrix().apply { postRotate(degrees) }, true)
    }
}

/**
 * The photo at [path] as an upright square from its middle, no larger than [side] pixels, written to [out] as a
 * JPEG (decision 0039). Only the pixels are written, so none of the original's metadata goes with it; the server
 * re-encodes it anyway, and that is the guarantee. False when [path] is not an image this device can read.
 */
fun squarePhoto(
    path: String,
    out: File,
    side: Int,
): Boolean {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(path, bounds)
    val short = minOf(bounds.outWidth, bounds.outHeight)
    // Sampled only as far as keeps the short side, the square's edge, at [side] or more.
    val photo = if (short > 0) decodePhoto(path, side * maxOf(bounds.outWidth, bounds.outHeight) / short) else null
    if (photo == null) return false
    val edge = minOf(photo.width, photo.height)
    val square = Bitmap.createBitmap(photo, (photo.width - edge) / 2, (photo.height - edge) / 2, edge, edge)
    val small = if (edge > side) square.scale(side, side) else square
    out.outputStream().use { small.compress(Bitmap.CompressFormat.JPEG, QUALITY, it) }
    return true
}

private fun rotation(path: String): Float =
    try {
        when (ExifInterface(path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
            ExifInterface.ORIENTATION_ROTATE_90 -> RIGHT
            ExifInterface.ORIENTATION_ROTATE_180 -> HALF
            ExifInterface.ORIENTATION_ROTATE_270 -> LEFT
            else -> 0f
        }
    } catch (_: IOException) {
        // Not a format with EXIF: as it is.
        0f
    }

private const val QUALITY = 90
private const val RIGHT = 90f
private const val HALF = 180f
private const val LEFT = 270f
