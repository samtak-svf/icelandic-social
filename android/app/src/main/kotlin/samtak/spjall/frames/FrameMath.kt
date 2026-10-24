package samtak.spjall.frames

import samtak.spjall.core.Focus
import samtak.spjall.core.Frame
import samtak.spjall.core.FrameOverride
import samtak.spjall.core.FrameRect
import samtak.spjall.core.Framing
import samtak.spjall.core.PixelRect

/** The size of the master in pixels. */
data class ImageSize(
    val w: Int,
    val h: Int,
)

/** A frame's shape; only the ratio matters. */
data class Aspect(
    val w: Int,
    val h: Int,
)

/** A point of the viewport as fractions of its width and height. */
data class Anchor(
    val u: Double,
    val v: Double,
)

/** The core's placing rule (`place_frame`), passed in so the maths never reimplements it and a JVM test can stand in. */
typealias Placer = (imageW: UInt, imageH: UInt, aspectW: UInt, aspectH: UInt, focus: Focus) -> PixelRect

/**
 * The crop editor's maths (decision 0086). A gesture moves a rectangle of the image, held as fractions of its width and
 * height, never leaving the image and never changing its shape. The placing rule itself is the core's ([Placer]); this
 * only moves what that rule placed.
 */
object FrameMath {
    /** How far past the whole frame a person may zoom in. */
    const val MAX_ZOOM = 8.0

    private fun fractions(
        px: PixelRect,
        image: ImageSize,
    ) = FrameRect(
        px.x.toDouble() / image.w,
        px.y.toDouble() / image.h,
        px.w.toDouble() / image.w,
        px.h.toDouble() / image.h,
    )

    private fun place(
        place: Placer,
        image: ImageSize,
        aspect: Aspect,
        focus: Focus,
    ) = fractions(place(image.w.toUInt(), image.h.toUInt(), aspect.w.toUInt(), aspect.h.toUInt(), focus), image)

    /** The largest rectangle of [aspect] the image holds, as fractions: the frame at zoom 1. */
    fun whole(
        image: ImageSize,
        aspect: Aspect,
        place: Placer,
    ): FrameRect = place(place, image, aspect, Focus(0.5, 0.5))

    /** The rectangle to start from: the one stored for this frame, else the one the focus places. */
    fun start(
        image: ImageSize,
        aspect: Aspect,
        focus: Focus,
        stored: FrameRect?,
        place: Placer,
    ): FrameRect = stored ?: place(place, image, aspect, focus)

    /** How far in [rect] is, against the whole-frame rectangle [whole] (1 is the whole frame). */
    fun zoomOf(
        rect: FrameRect,
        whole: FrameRect,
    ): Double = whole.w / rect.w

    /** A rectangle moved inside the image; the sum of an edge never passes 1, which the contract refuses. */
    private fun settle(
        x: Double,
        y: Double,
        w: Double,
        h: Double,
    ): FrameRect {
        var left = x.coerceIn(0.0, 1 - w)
        var top = y.coerceIn(0.0, 1 - h)
        val step = Math.ulp(1.0)
        while (left + w > 1) left -= step
        while (top + h > 1) top -= step
        return FrameRect(maxOf(0.0, left), maxOf(0.0, top), w, h)
    }

    /** The image moves with the finger: the window moves against it, by the share of the viewport dragged. */
    fun drag(
        rect: FrameRect,
        dx: Double,
        dy: Double,
        viewW: Double,
        viewH: Double,
    ): FrameRect = settle(rect.x - dx / viewW * rect.w, rect.y - dy / viewH * rect.h, rect.w, rect.h)

    /** Zooms by [factor] (above 1 is in) keeping the image point under [anchor] where it is. */
    fun zoom(
        rect: FrameRect,
        image: ImageSize,
        aspect: Aspect,
        factor: Double,
        anchor: Anchor,
        place: Placer,
    ): FrameRect {
        val whole = whole(image, aspect, place)
        val w = minOf(whole.w, maxOf(whole.w / MAX_ZOOM, rect.w / factor))
        val h = w * image.w * aspect.h / (aspect.w * image.h)
        val pointX = rect.x + anchor.u * rect.w
        val pointY = rect.y + anchor.v * rect.h
        // At the whole-frame width the height may differ from the rounded one by a pixel's share.
        return settle(pointX - anchor.u * w, pointY - anchor.v * h, w, minOf(h, 1.0))
    }

    /** The point a rectangle is centred on, which every frame without an override is placed from. */
    fun focusOf(rect: FrameRect): Focus = Focus(rect.x + rect.w / 2, rect.y + rect.h / 2)

    /**
     * The framing to send: the stored one with the rectangles the person adjusted as overrides, and the centre of the
     * one adjusted last as the focus. [reset] drops every override and keeps the focus.
     */
    fun framingOf(
        base: Framing?,
        edits: Map<Frame, FrameRect>,
        last: Frame?,
        reset: Boolean = false,
    ): Framing {
        val lastRect = last?.let(edits::get)
        val focus = lastRect?.let(::focusOf) ?: base?.focus ?: Focus(0.5, 0.5)
        if (reset) return Framing(focus, emptyList())
        val merged = LinkedHashMap<Frame, FrameRect>()
        base?.overrides?.forEach { merged[it.frame] = it.rect }
        merged.putAll(edits)
        return Framing(focus, merged.map { FrameOverride(it.key, it.value) })
    }
}
