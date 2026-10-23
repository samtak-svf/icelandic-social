package samtak.spjall.me.link

import com.google.zxing.BinaryBitmap
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.ReaderException
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader

/**
 * The text of the QR code in a camera frame's luminance plane, or null when the frame holds none.
 * [rowStride] is the plane's row length in bytes, which the camera may pad past [width].
 */
internal fun decodeQr(
    luma: ByteArray,
    rowStride: Int,
    width: Int,
    height: Int,
): String? {
    val source = PlanarYUVLuminanceSource(luma, rowStride, height, 0, 0, width, height, false)
    val reader = QRCodeReader()
    return try {
        reader.decode(BinaryBitmap(HybridBinarizer(source))).text
    } catch (_: ReaderException) {
        null
    } finally {
        reader.reset()
    }
}
