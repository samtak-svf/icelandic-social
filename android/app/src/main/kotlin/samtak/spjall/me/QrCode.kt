package samtak.spjall.me

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter

/**
 * [text] as a QR code, drawn module by module so it stays sharp at any size.
 * Dark on light from the theme, with the quiet zone scanners need.
 */
@Composable
fun QrCode(
    text: String,
    description: String,
    modifier: Modifier = Modifier,
) {
    val matrix =
        remember(text) {
            QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, 0, 0, mapOf(EncodeHintType.MARGIN to QUIET_ZONE))
        }
    val dark = MaterialTheme.colorScheme.onSurface
    val light = MaterialTheme.colorScheme.surface
    Canvas(modifier = modifier.aspectRatio(1f).semantics { contentDescription = description }) {
        drawRect(light)
        val cell = size.width / matrix.width
        for (y in 0 until matrix.height) {
            for (x in 0 until matrix.width) {
                if (matrix[x, y]) drawRect(dark, Offset(x * cell, y * cell), Size(cell, cell))
            }
        }
    }
}

private const val QUIET_ZONE = 2
