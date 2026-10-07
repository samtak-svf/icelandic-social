package samtak.spjall.media

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import androidx.exifinterface.media.ExifInterface
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

private const val RIGHT = 90f
private const val HALF = 180f
private const val LEFT = 270f
