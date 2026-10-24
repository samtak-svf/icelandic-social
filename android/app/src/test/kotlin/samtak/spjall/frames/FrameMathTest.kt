package samtak.spjall.frames

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import samtak.spjall.core.Focus
import samtak.spjall.core.Frame
import samtak.spjall.core.FrameOverride
import samtak.spjall.core.FrameRect
import samtak.spjall.core.Framing
import samtak.spjall.core.PixelRect
import kotlin.math.max
import kotlin.math.min

/**
 * The editor's maths (decision 0086): a gesture moves a rectangle of the image, in fractions, and the rectangle never
 * leaves the image or changes its shape. The core's placing rule is stood in for by a copy of it here, so these run on
 * the JVM; the rule itself is the core's own tests'.
 */
class FrameMathTest {
    private val place: Placer = { w, h, aw, ah, focus ->
        // The largest rectangle of the aspect, centred on the focus and moved inside the image.
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

    private val wide = ImageSize(4000, 3000)
    private val square = Aspect(1, 1)
    private val cover = Aspect(8, 3)
    private val centre = Focus(0.5, 0.5)

    private fun shape(
        r: FrameRect,
        image: ImageSize,
    ) = (r.w * image.w) / (r.h * image.h)

    private fun inside(r: FrameRect) = r.x >= 0 && r.y >= 0 && r.x + r.w <= 1 && r.y + r.h <= 1 && r.w > 0 && r.h > 0

    private fun start(aspect: Aspect) = FrameMath.start(wide, aspect, centre, null, place)

    @Test
    fun aSquareStartsAtTheCentreOfALandscapeImage() {
        val r = start(square)
        assertEquals(1.0, r.h, 1e-3)
        assertEquals(0.75, r.w, 1e-3)
        assertEquals(0.125, r.x, 1e-3)
    }

    @Test
    fun aRectangleIsPlacedFromTheFocusAndMovedInsideAtAnEdge() {
        assertEquals(0.0, FrameMath.start(wide, square, Focus(0.0, 0.5), null, place).x, 0.0)
    }

    @Test
    fun aStoredRectangleWinsOverTheFocus() {
        val stored = FrameRect(0.1, 0.2, 0.3, 0.4)
        assertEquals(stored, FrameMath.start(wide, cover, centre, stored, place))
    }

    @Test
    fun aDragMovesTheWindowAgainstTheFingerByTheShareOfTheViewportDragged() {
        val start = start(cover)
        val zoomed = FrameMath.zoom(start, wide, cover, 2.0, Anchor(0.5, 0.5), place)
        val moved = FrameMath.drag(zoomed, 100.0, 0.0, 400.0, 150.0)
        assertEquals(zoomed.x - 0.25 * zoomed.w, moved.x, 1e-6)
        assertEquals(zoomed.y, moved.y, 1e-6)
    }

    @Test
    fun aDragStopsAtTheEdgeOfTheImage() {
        val moved = FrameMath.drag(start(cover), -100000.0, 100000.0, 400.0, 150.0)
        assertTrue(inside(moved))
        assertEquals(1.0, moved.x + moved.w, 1e-9)
        assertEquals(0.0, moved.y, 0.0)
    }

    @Test
    fun zoomingKeepsTheShapeAndThePointUnderTheFingers() {
        val start = start(cover)
        val anchor = Anchor(0.25, 0.75)
        val beforeX = start.x + anchor.u * start.w
        val beforeY = start.y + anchor.v * start.h
        val zoomed = FrameMath.zoom(start, wide, cover, 2.0, anchor, place)
        assertEquals(8.0 / 3.0, shape(zoomed, wide), 1e-6)
        assertEquals(start.w / 2, zoomed.w, 1e-6)
        assertEquals(beforeX, zoomed.x + anchor.u * zoomed.w, 1e-6)
        assertEquals(beforeY, zoomed.y + anchor.v * zoomed.h, 1e-6)
    }

    @Test
    fun zoomingNeverGoesOutPastTheWholeImageOrInPastTheLimit() {
        val start = start(cover)
        val out = FrameMath.zoom(start, wide, cover, 0.01, Anchor(0.5, 0.5), place)
        assertEquals(start.w, out.w, 1e-9)
        val far = FrameMath.zoom(start, wide, cover, 1000.0, Anchor(0.5, 0.5), place)
        assertEquals(FrameMath.MAX_ZOOM, FrameMath.zoomOf(far, start), 1e-6)
        assertTrue(inside(far))
    }

    @Test
    fun zoomingOutAtAnEdgeStaysInside() {
        val start = start(cover)
        val corner = FrameRect(0.7, 0.5, start.w / 4, start.h / 4)
        assertTrue(inside(FrameMath.zoom(corner, wide, cover, 0.1, Anchor(1.0, 0.0), place)))
    }

    @Test
    fun aRectangleAtTheFarEdgeStillSatisfiesTheContractsSum() {
        val far = FrameMath.start(wide, cover, Focus(1.0, 1.0), null, place)
        val r = FrameMath.zoom(far, wide, cover, 3.0, Anchor(0.9, 0.9), place)
        assertTrue(r.x + r.w <= 1.0)
        assertTrue(r.y + r.h <= 1.0)
    }

    @Test
    fun theFocusIsTheCentreOfTheRectangle() {
        val focus = FrameMath.focusOf(FrameRect(0.2, 0.1, 0.4, 0.2))
        assertEquals(Focus(0.4, 0.2), Focus(focus.x.round(), focus.y.round()))
    }

    @Test
    fun theChosenRectangleBecomesItsFramesOverrideAndItsCentreTheFocus() {
        val rect = FrameRect(0.2, 0.1, 0.4, 0.2)
        val framing = FrameMath.framingOf(null, mapOf(Frame.COMPACT to rect), FrameMath.focusOf(rect))
        assertEquals(0.4, framing.focus.x, 1e-9)
        assertEquals(0.2, framing.focus.y, 1e-9)
        assertEquals(listOf(FrameOverride(Frame.COMPACT, rect)), framing.overrides)
    }

    @Test
    fun framesNotTouchedKeepTheirStoredOverrideAndAResetClearsThem() {
        val medium = FrameOverride(Frame.MEDIUM, FrameRect(0.0, 0.0, 1.0, 0.25))
        val stored = Framing(Focus(0.5, 0.5), listOf(medium))
        val rect = FrameRect(0.2, 0.1, 0.4, 0.2)
        val framing = FrameMath.framingOf(stored, mapOf(Frame.EXPANDED to rect), null)
        assertEquals(setOf(medium, FrameOverride(Frame.EXPANDED, rect)), framing.overrides.toSet())
        assertEquals(Framing(Focus(0.5, 0.5), emptyList()), FrameMath.framingOf(stored, emptyMap(), null, reset = true))
    }

    @Test
    fun anAdvancedEditKeepsTheStoredFocus() {
        val rect = FrameRect(0.2, 0.1, 0.4, 0.2)
        val stored = Framing(Focus(0.3, 0.6), emptyList())
        val framing = FrameMath.framingOf(stored, mapOf(Frame.MEDIUM to rect), null)
        assertEquals(Focus(0.3, 0.6), framing.focus)
        assertEquals(listOf(FrameOverride(Frame.MEDIUM, rect)), framing.overrides)
    }

    @Test
    fun theFocusIsKeptWhenNothingWasTouched() {
        assertEquals(Focus(0.3, 0.6), FrameMath.framingOf(Framing(Focus(0.3, 0.6)), emptyMap(), null).focus)
    }

    @Test
    fun aRectangleEditedTwiceKeepsTheLastEdit() {
        val first = FrameRect(0.1, 0.1, 0.2, 0.2)
        val second = FrameRect(0.3, 0.3, 0.2, 0.2)
        val stored = Framing(Focus(0.5, 0.5), listOf(FrameOverride(Frame.SQUARE, first)))
        val framing = FrameMath.framingOf(stored, mapOf(Frame.SQUARE to second), null)
        assertEquals(listOf(FrameOverride(Frame.SQUARE, second)), framing.overrides)
    }

    private fun Double.round() = Math.round(this * 1e9) / 1e9
}
