package samtak.spjall.me.link

import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy

/**
 * Reads QR codes off the camera's frames and reports the first whose text [accepts] says is wanted: another
 * code in view (a poster, a ticket) is passed over without a word. [onCode] is called on the analysis thread.
 */
internal class LinkScanAnalyzer(
    private val accepts: (String) -> Boolean,
    private val onCode: (String) -> Unit,
) : ImageAnalysis.Analyzer {
    @Volatile private var found = false

    override fun analyze(image: ImageProxy) {
        image.use {
            if (found) return
            val plane = it.planes[0]
            val buffer = plane.buffer
            val luma = ByteArray(buffer.remaining()).also(buffer::get)
            val text = decodeQr(luma, plane.rowStride, it.width, it.height)
            if (text != null && accepts(text)) {
                found = true
                onCode(text)
            }
        }
    }
}
