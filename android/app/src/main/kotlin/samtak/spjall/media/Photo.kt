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

/**
 * The photo at [path] cropped from its middle to the [width] by [height] proportion, no wider than [width] pixels,
 * written to [out] as a JPEG (0080 covers). As [squarePhoto], only the pixels are written. False when [path] is not
 * an image this device can read.
 */
fun coverPhoto(
    path: String,
    out: File,
    width: Int,
    height: Int,
): Boolean {
    val photo = decodePhoto(path, width) ?: return false
    // The largest centred rectangle of the cover's proportion that fits the photo.
    val cropWidth = minOf(photo.width, photo.height * width / height)
    val cropHeight = cropWidth * height / width
    val crop =
        Bitmap.createBitmap(
            photo,
            (photo.width - cropWidth) / 2,
            (photo.height - cropHeight) / 2,
            cropWidth,
            cropHeight,
        )
    val small = if (cropWidth > width) crop.scale(width, height) else crop
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

/**
 * Clears the GPS fields of the photo at [path] in place when [mime] is a format whose metadata can be
 * written without encoding the photo again (decision 0048). Another format, such as HEIC, goes as the
 * system picker gave it.
 */
fun stripLocation(
    path: String,
    mime: String,
) {
    if (mime in WRITABLE) stripLocation(path)
}

private val WRITABLE = setOf("image/jpeg", "image/png", "image/webp")

/** Clears the GPS fields of the JPEG at [path] in place, keeping its orientation (decision 0047). */
fun stripLocation(path: String) {
    val exif = ExifInterface(path)
    GPS_TAGS.forEach { exif.setAttribute(it, null) }
    exif.saveAttributes()
}

private val GPS_TAGS =
    listOf(
        ExifInterface.TAG_GPS_VERSION_ID,
        ExifInterface.TAG_GPS_LATITUDE_REF,
        ExifInterface.TAG_GPS_LATITUDE,
        ExifInterface.TAG_GPS_LONGITUDE_REF,
        ExifInterface.TAG_GPS_LONGITUDE,
        ExifInterface.TAG_GPS_ALTITUDE_REF,
        ExifInterface.TAG_GPS_ALTITUDE,
        ExifInterface.TAG_GPS_TIMESTAMP,
        ExifInterface.TAG_GPS_SATELLITES,
        ExifInterface.TAG_GPS_STATUS,
        ExifInterface.TAG_GPS_MEASURE_MODE,
        ExifInterface.TAG_GPS_DOP,
        ExifInterface.TAG_GPS_SPEED_REF,
        ExifInterface.TAG_GPS_SPEED,
        ExifInterface.TAG_GPS_TRACK_REF,
        ExifInterface.TAG_GPS_TRACK,
        ExifInterface.TAG_GPS_IMG_DIRECTION_REF,
        ExifInterface.TAG_GPS_IMG_DIRECTION,
        ExifInterface.TAG_GPS_MAP_DATUM,
        ExifInterface.TAG_GPS_DEST_LATITUDE_REF,
        ExifInterface.TAG_GPS_DEST_LATITUDE,
        ExifInterface.TAG_GPS_DEST_LONGITUDE_REF,
        ExifInterface.TAG_GPS_DEST_LONGITUDE,
        ExifInterface.TAG_GPS_DEST_BEARING_REF,
        ExifInterface.TAG_GPS_DEST_BEARING,
        ExifInterface.TAG_GPS_DEST_DISTANCE_REF,
        ExifInterface.TAG_GPS_DEST_DISTANCE,
        ExifInterface.TAG_GPS_PROCESSING_METHOD,
        ExifInterface.TAG_GPS_AREA_INFORMATION,
        ExifInterface.TAG_GPS_DATESTAMP,
        ExifInterface.TAG_GPS_DIFFERENTIAL,
        ExifInterface.TAG_GPS_H_POSITIONING_ERROR,
    )
