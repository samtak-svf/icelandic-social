package samtak.spjall.frames

import android.annotation.SuppressLint
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.platform.LocalConfiguration
import samtak.spjall.core.Frame
import samtak.spjall.core.FrameKind
import samtak.spjall.core.framesOf
import samtak.spjall.core.frameForWidth as coreFrameForWidth
import samtak.spjall.core.frameSize as coreFrameSize
import samtak.spjall.core.placeFrame as corePlaceFrame

/**
 * The window's width in dp, which picks a cover's frame and the layout; it follows a rotation, a resize and an
 * unfolding, because the configuration is the window's own. It is read from the configuration and not from
 * `LocalWindowInfo.containerSize`, which a Robolectric window does not size to its qualifiers, so a layout test
 * could not set a width.
 */
@SuppressLint("ConfigurationScreenWidthHeight")
@Composable
fun windowWidthDp(): Int = LocalConfiguration.current.screenWidthDp

/** The rules the screens read; a screen test that cannot load the native library provides a stand-in. */
val LocalFrameRules = compositionLocalOf<FrameRules> { CoreFrameRules }

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
