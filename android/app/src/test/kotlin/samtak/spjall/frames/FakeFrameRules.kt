package samtak.spjall.frames

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import samtak.spjall.core.Frame
import samtak.spjall.core.FrameKind
import samtak.spjall.core.PixelRect
import kotlin.math.max
import kotlin.math.min

/**
 * The core's frame rules for a JVM test, which cannot load the native library: the size classes of decision 0086
 * (compact under 600 dp, medium under 840, expanded from there; a cover 3:1, 4:1 and 8:3; a photo one square) and the
 * placing rule, the largest rectangle of the aspect centred on the focus and kept inside the image.
 */
object FakeFrameRules : FrameRules {
    private const val MEDIUM_FROM = 600
    private const val EXPANDED_FROM = 840

    override fun frameForWidth(
        kind: FrameKind,
        widthDp: Int,
    ) = when {
        kind == FrameKind.PHOTO -> Frame.SQUARE
        widthDp < MEDIUM_FROM -> Frame.COMPACT
        widthDp < EXPANDED_FROM -> Frame.MEDIUM
        else -> Frame.EXPANDED
    }

    override fun aspect(
        kind: FrameKind,
        frame: Frame,
    ) = when (frame) {
        Frame.COMPACT -> Aspect(3, 1)
        Frame.MEDIUM -> Aspect(4, 1)
        Frame.EXPANDED -> Aspect(8, 3)
        Frame.SQUARE -> Aspect(1, 1)
    }

    override fun frames(kind: FrameKind) =
        if (kind == FrameKind.PHOTO) listOf(Frame.SQUARE) else listOf(Frame.COMPACT, Frame.MEDIUM, Frame.EXPANDED)

    override val place: Placer = { w, h, aw, ah, focus ->
        val (rw, rh) =
            if (w.toLong() * ah.toLong() >= h.toLong() * aw.toLong()) {
                (h.toLong() * aw.toLong() / ah.toLong()).toInt() to h.toInt()
            } else {
                w.toInt() to (w.toLong() * ah.toLong() / aw.toLong()).toInt()
            }
        val x = min(max(0.0, focus.x * w.toDouble() - rw / 2.0), (w.toInt() - rw).toDouble())
        val y = min(max(0.0, focus.y * h.toDouble() - rh / 2.0), (h.toInt() - rh).toDouble())
        PixelRect(x.toInt().toUInt(), y.toInt().toUInt(), rw.toUInt(), rh.toUInt())
    }
}

/** A 1600 by 1200 picture of coloured bands, so a crop of it shows which part of it was framed. */
fun bandedImage(): ImageBitmap {
    val bitmap = Bitmap.createBitmap(1600, 1200, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val paint = Paint()
    val colours = listOf(Color.RED, Color.YELLOW, Color.GREEN, Color.CYAN, Color.BLUE, Color.MAGENTA)
    colours.forEachIndexed { i, colour ->
        paint.color = colour
        canvas.drawRect(0f, i * 200f, 1600f, (i + 1) * 200f, paint)
    }
    return bitmap.asImageBitmap()
}
