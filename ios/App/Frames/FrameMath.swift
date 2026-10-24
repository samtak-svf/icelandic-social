import CoreGraphics
import Foundation
import SpjallCore

/// The crop editor's maths (decision 0086). A gesture moves a rectangle of the image, held as fractions of its
/// width and height, never leaving the image and never changing its shape. The placing rule itself is the core's
/// (`placeFrame`); this only moves what that rule placed. The web editor's `frame-math.ts` is the reference.
enum FrameMath {
    /// How far past the whole frame a person may zoom in.
    static let maxZoom = 8.0

    /// The size of the master in pixels.
    struct ImageSize: Equatable, Sendable {
        var w: Double
        var h: Double
    }

    /// A frame's shape; only the ratio matters.
    struct Aspect: Equatable, Sendable {
        var w: Double
        var h: Double
        var ratio: Double { w / h }
    }

    /// The largest rectangle of `aspect` the image holds, centred, as fractions.
    static func whole(_ image: ImageSize, _ aspect: Aspect) -> FrameRect {
        fractions(
            placeFrame(
                imageW: UInt32(image.w), imageH: UInt32(image.h), aspectW: UInt32(aspect.w), aspectH: UInt32(aspect.h),
                focus: Focus(x: 0.5, y: 0.5)), image)
    }

    /// The rectangle to start from: the one stored for this frame, else the one the focus places.
    static func start(_ image: ImageSize, _ aspect: Aspect, focus: Focus, stored: FrameRect?) -> FrameRect {
        if let stored { return stored }
        return fractions(
            placeFrame(
                imageW: UInt32(image.w), imageH: UInt32(image.h), aspectW: UInt32(aspect.w), aspectH: UInt32(aspect.h),
                focus: focus), image)
    }

    private static func fractions(_ px: PixelRect, _ image: ImageSize) -> FrameRect {
        FrameRect(
            x: Double(px.x) / image.w, y: Double(px.y) / image.h, w: Double(px.w) / image.w, h: Double(px.h) / image.h)
    }

    /// A rectangle moved inside the image; the sum of an edge never passes 1, which the contract refuses.
    static func settle(_ x: Double, _ y: Double, _ w: Double, _ h: Double) -> FrameRect {
        var left = min(max(0, x), 1 - w)
        var top = min(max(0, y), 1 - h)
        while left + w > 1 { left -= Double.ulpOfOne }
        while top + h > 1 { top -= Double.ulpOfOne }
        return FrameRect(x: max(0, left), y: max(0, top), w: w, h: h)
    }

    /// How far in `rect` is, against the whole-frame rectangle `whole` (1 is the whole frame).
    static func zoom(of rect: FrameRect, whole: FrameRect) -> Double { whole.w / rect.w }

    /// The image moves with the finger: the window moves against it, by the share of the viewport dragged.
    static func drag(_ rect: FrameRect, dx: Double, dy: Double, viewport: CGSize) -> FrameRect {
        guard viewport.width > 0, viewport.height > 0 else { return rect }
        return settle(
            rect.x - dx / viewport.width * rect.w, rect.y - dy / viewport.height * rect.h, rect.w, rect.h)
    }

    /// Zooms by `factor` (above 1 is in) keeping the image point under `anchor` (fractions of the viewport) where
    /// it is.
    static func zoomed(
        _ rect: FrameRect, image: ImageSize, aspect: Aspect, factor: Double, anchorX: Double, anchorY: Double
    ) -> FrameRect {
        guard factor > 0, factor.isFinite else { return rect }
        let all = whole(image, aspect)
        let w = min(all.w, max(all.w / maxZoom, rect.w / factor))
        let h = w * image.w / (aspect.ratio * image.h)
        let pointX = rect.x + anchorX * rect.w
        let pointY = rect.y + anchorY * rect.h
        return settle(pointX - anchorX * w, pointY - anchorY * h, w, min(h, 1))
    }

    /// The point a rectangle is centred on, which every frame without an override is placed from.
    static func focus(of rect: FrameRect) -> Focus { Focus(x: rect.x + rect.w / 2, y: rect.y + rect.h / 2) }
}
