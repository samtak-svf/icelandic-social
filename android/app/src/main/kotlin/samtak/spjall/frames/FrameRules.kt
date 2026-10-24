package samtak.spjall.frames

import samtak.spjall.core.Frame
import samtak.spjall.core.FrameKind
import samtak.spjall.core.framesOf
import samtak.spjall.core.frameForWidth as coreFrameForWidth
import samtak.spjall.core.frameSize as coreFrameSize
import samtak.spjall.core.placeFrame as corePlaceFrame

/**
 * What the core decides about frames (decision 0086), behind a seam so a screen test needs no native library. The
 * app never hard-codes a frame's size or the rule that places one; it asks here.
 */
interface FrameRules {
    /** The frame for a window [widthDp] dp wide: a cover's size class, always `SQUARE` for a photo. */
    fun frameForWidth(
        kind: FrameKind,
        widthDp: Int,
    ): Frame

    /** The shape of [frame] as a width and a height, whose ratio is all that matters. */
    fun aspect(
        kind: FrameKind,
        frame: Frame,
    ): Aspect

    /** Every frame of [kind], smallest window first. */
    fun frames(kind: FrameKind): List<Frame>

    /** The placing rule, which [FrameMath] moves a rectangle from. */
    val place: Placer
}

/** [FrameRules] as the core answers them. */
object CoreFrameRules : FrameRules {
    override fun frameForWidth(
        kind: FrameKind,
        widthDp: Int,
    ) = coreFrameForWidth(kind, widthDp.coerceAtLeast(0).toUInt())

    override fun aspect(
        kind: FrameKind,
        frame: Frame,
    ): Aspect {
        val size = checkNotNull(coreFrameSize(kind, frame)) { "no $frame frame for $kind" }
        return Aspect(size.w.toInt(), size.h.toInt())
    }

    override fun frames(kind: FrameKind) = framesOf(kind)

    override val place: Placer = { imageW, imageH, aspectW, aspectH, focus ->
        corePlaceFrame(imageW, imageH, aspectW, aspectH, focus)
    }
}
