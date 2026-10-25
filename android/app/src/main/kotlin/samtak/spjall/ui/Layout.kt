package samtak.spjall.ui

import androidx.compose.runtime.Composable
import samtak.spjall.core.Frame
import samtak.spjall.core.FrameKind
import samtak.spjall.frames.CoreFrameRules
import samtak.spjall.frames.FrameRules
import samtak.spjall.frames.LocalFrameRules
import samtak.spjall.frames.windowWidthDp

/** How the five places are reached: a bar along the bottom, or a rail down the left. */
enum class Navigation { BAR, RAIL }

/**
 * What each size class lays out (decision 0087), the one map from a window to a layout; the screens read this and
 * never a width, and the tests read it to know what to expect.
 */
data class Layout(
    val navigation: Navigation,
    /** The community page: the feed alone, or the feed with Um samfélagið beside it. */
    val aside: Boolean,
    /** Stjórna: one dialog of buttons, or a section list beside the section chosen. */
    val manageSideNav: Boolean,
)

/**
 * The size class of a window [widthDp] dp wide. It is the core's answer for a cover (the breakpoints of 0086 are
 * the layout's breakpoints), so no width is typed here.
 */
fun windowClassOf(
    widthDp: Int,
    rules: FrameRules = CoreFrameRules,
): Frame = rules.frameForWidth(FrameKind.COVER, widthDp)

/** The layout of a window of size class [window]. */
fun layoutOf(window: Frame): Layout =
    when (window) {
        Frame.COMPACT, Frame.SQUARE -> Layout(Navigation.BAR, aside = false, manageSideNav = false)
        Frame.MEDIUM -> Layout(Navigation.RAIL, aside = false, manageSideNav = false)
        Frame.EXPANDED -> Layout(Navigation.RAIL, aside = true, manageSideNav = true)
    }

/** The layout of the window being drawn in; it follows a rotation, a resize and an unfolding. */
@Composable
fun currentLayout(): Layout = layoutOf(windowClassOf(windowWidthDp(), LocalFrameRules.current))
