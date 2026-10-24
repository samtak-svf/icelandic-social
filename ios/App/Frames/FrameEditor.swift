import CoreGraphics
import Foundation
import Observation
import SpjallCore

/// The window width a frame is chosen by: a cover follows the size classes (`frameForWidth`, decision 0086),
/// from the container's width in points once it is known, and from the horizontal size class until then.
func coverFrame(width: CGFloat?, compactClass: Bool?) -> Frame {
    if let width, width > 0 { return frameForWidth(kind: .cover, widthDp: UInt32(width)) }
    return compactClass == true ? .compact : .expanded
}

/// The state of one crop sheet (decision 0086): the image being framed, the rectangle of each frame the person
/// adjusted, and whether the advanced panel is open. The default level adjusts the one frame of the screen the
/// person is on and moves the focus with it; the advanced level (covers only, closed until asked for) adjusts all
/// three and leaves the focus alone, so a frame left untouched is saved where it was shown.
@MainActor @Observable final class FrameEditor {
    let kind: FrameKind
    let image: FrameMath.ImageSize
    /// The frame of the screen the person is on.
    let current: Frame
    /// The framing the image had when the sheet opened; none for a new image.
    private let base: Framing?
    private(set) var edits: [Frame: FrameRect] = [:]
    /// The point the single-frame level chose, which every frame without an override is placed from; none keeps the
    /// stored focus.
    private(set) var focus: Focus?
    /// Every override dropped back to automatic.
    private(set) var reset = false
    /// Whether the advanced panel is open; it never opens by itself.
    var advancedOpen = false

    init(kind: FrameKind, image: FrameMath.ImageSize, current: Frame, base: Framing?) {
        self.kind = kind
        self.image = image
        self.current = current
        self.base = base
    }

    /// The link to the advanced panel exists for a cover only: a picture or a photo has one frame.
    var offersAdvanced: Bool { kind == .cover }

    /// The frames the sheet shows: the screen's own, or in the advanced panel all of the kind's.
    var shown: [Frame] { advancedOpen && offersAdvanced ? framesOf(kind: kind) : [current] }

    func aspect(_ frame: Frame) -> FrameMath.Aspect {
        let size = frameSize(kind: kind, frame: frame)
        return FrameMath.Aspect(w: Double(size?.w ?? 1), h: Double(size?.h ?? 1))
    }

    /// The rectangle `frame` shows now: what the person adjusted, else the one stored for it, else the one the
    /// focus places.
    func rect(_ frame: Frame) -> FrameRect {
        let stored = reset ? nil : base?.overrides.first { $0.frame == frame }?.rect
        return edits[frame] ?? FrameMath.start(image, aspect(frame), focus: placingFocus, stored: stored)
    }

    /// Where frames without an override are placed from: the chosen focus, else the stored one, else the centre.
    private var placingFocus: Focus { focus ?? base?.focus ?? Focus(x: 0.5, y: 0.5) }

    func drag(_ frame: Frame, dx: Double, dy: Double, viewport: CGSize) {
        set(frame, FrameMath.drag(rect(frame), dx: dx, dy: dy, viewport: viewport))
    }

    func zoom(_ frame: Frame, factor: Double, anchorX: Double = 0.5, anchorY: Double = 0.5) {
        set(
            frame,
            FrameMath.zoomed(
                rect(frame), image: image, aspect: aspect(frame), factor: factor, anchorX: anchorX, anchorY: anchorY))
    }

    /// The zoom a slider shows, 1 for the whole frame.
    func zoomLevel(_ frame: Frame) -> Double {
        FrameMath.zoom(of: rect(frame), whole: FrameMath.whole(image, aspect(frame)))
    }

    func setZoomLevel(_ frame: Frame, _ level: Double) {
        zoom(frame, factor: level / zoomLevel(frame))
    }

    private func set(_ frame: Frame, _ rect: FrameRect) {
        edits[frame] = rect
        if !(advancedOpen && offersAdvanced) { focus = FrameMath.focus(of: rect) }
    }

    /// Back to automatic: every override dropped, the focus kept (decision 0086).
    func resetToAutomatic() {
        edits = [:]
        focus = nil
        reset = true
    }

    /// What Save sends: the stored framing with the rectangles the person adjusted as overrides, and the focus the
    /// single-frame level chose, else the stored one. A reset drops every override and keeps the stored focus.
    func framing() -> Framing {
        var overrides = reset ? [] : (base?.overrides ?? [])
        for (frame, rect) in edits {
            overrides.removeAll { $0.frame == frame }
            overrides.append(FrameOverride(frame: frame, rect: rect))
        }
        // A fixed order, so the same edits send the same body.
        let order = framesOf(kind: kind)
        overrides.sort { (order.firstIndex(of: $0.frame) ?? 0) < (order.firstIndex(of: $1.frame) ?? 0) }
        return Framing(focus: placingFocus, overrides: overrides)
    }
}
