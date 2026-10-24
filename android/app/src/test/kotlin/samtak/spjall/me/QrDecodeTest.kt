package samtak.spjall.me

import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import samtak.spjall.me.link.decodeQr

class QrDecodeTest {
    /** A frame the way the camera hands it: a luminance plane whose rows are padded past the width. */
    private fun frame(
        text: String,
        padding: Int,
    ): Triple<ByteArray, Int, Int> {
        val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, SIDE, SIDE, mapOf(EncodeHintType.MARGIN to 4))
        val stride = matrix.width + padding
        val luma = ByteArray(stride * matrix.height) { 0x7f }
        for (y in 0 until matrix.height) {
            for (x in 0 until matrix.width) luma[y * stride + x] = if (matrix[x, y]) 0 else -1
        }
        return Triple(luma, stride, matrix.width)
    }

    @Test
    fun readsACodeFromAPaddedPlane() {
        val (luma, stride, width) = frame("hello-code", padding = 24)
        assertEquals("hello-code", decodeQr(luma, stride, width, SIDE))
    }

    @Test
    fun aFrameWithoutACodeIsNull() {
        val blank = ByteArray(SIDE * SIDE) { -1 }
        assertNull(decodeQr(blank, SIDE, SIDE, SIDE))
    }

    private companion object {
        const val SIDE = 300
    }
}
