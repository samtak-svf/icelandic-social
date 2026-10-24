import CoreGraphics
import SpjallCore
import XCTest

@testable import Spjall

/// The crop sheet's state (decision 0086): the advanced link is a cover's alone and starts closed, and Save sends the
/// framing the person made.
@MainActor
final class FrameEditorTests: XCTestCase {
    private let image = FrameMath.ImageSize(w: 2400, h: 1200)

    private func editor(_ kind: FrameKind, current: Frame, base: Framing? = nil) -> FrameEditor {
        FrameEditor(kind: kind, image: image, current: current, base: base)
    }

    func testTheAdvancedLinkExistsForACoverAloneAndStartsCollapsed() {
        let cover = editor(.cover, current: .compact)
        XCTAssertTrue(cover.offersAdvanced)
        XCTAssertFalse(cover.advancedOpen, "it is never open until asked for")
        XCTAssertEqual(cover.shown, [.compact], "one frame, the screen's own")
        let photo = editor(.photo, current: .square)
        XCTAssertFalse(photo.offersAdvanced)
        XCTAssertFalse(photo.advancedOpen)
        photo.advancedOpen = true
        XCTAssertEqual(photo.shown, [.square], "a photo has one frame even if something opened the panel")
    }

    func testOpeningAdvancedShowsEveryFrameOfACover() {
        let cover = editor(.cover, current: .medium)
        cover.advancedOpen = true
        XCTAssertEqual(cover.shown, framesOf(kind: .cover))
        XCTAssertEqual(cover.shown.count, 3)
    }

    func testAnUntouchedSheetSavesTheCentreAndNoOverrides() {
        let framing = editor(.cover, current: .expanded).framing()
        XCTAssertEqual(framing.focus.x, 0.5, accuracy: 1e-9)
        XCTAssertEqual(framing.focus.y, 0.5, accuracy: 1e-9)
        XCTAssertEqual(framing.overrides, [])
    }

    func testADragBecomesTheOverrideOfThatFrameAndItsCentreTheFocus() {
        let cover = editor(.cover, current: .compact)
        let before = cover.rect(.compact)
        cover.drag(.compact, dx: -30, dy: 0, viewport: CGSize(width: 300, height: 100))
        let after = cover.rect(.compact)
        XCTAssertGreaterThanOrEqual(after.x, before.x)
        let framing = cover.framing()
        XCTAssertEqual(framing.overrides.map(\.frame), [.compact])
        XCTAssertEqual(framing.overrides.first?.rect, after)
        XCTAssertEqual(framing.focus.x, after.x + after.w / 2, accuracy: 1e-9)
        XCTAssertEqual(framing.focus.y, after.y + after.h / 2, accuracy: 1e-9)
    }

    func testZoomAndTheSliderAgree() {
        let photo = editor(.photo, current: .square)
        XCTAssertEqual(photo.zoomLevel(.square), 1, accuracy: 1e-9)
        photo.setZoomLevel(.square, 2)
        XCTAssertEqual(photo.zoomLevel(.square), 2, accuracy: 1e-6)
        photo.setZoomLevel(.square, 100)
        XCTAssertEqual(photo.zoomLevel(.square), FrameMath.maxZoom, accuracy: 1e-6)
    }

    func testEditsToSeveralFramesComeOutInTheKindsOrderAndKeepWhatWasStored() {
        let stored = FrameOverride(frame: .medium, rect: FrameRect(x: 0.1, y: 0.1, w: 0.5, h: 0.2))
        let cover = editor(.cover, current: .compact, base: Framing(focus: Focus(x: 0.5, y: 0.5), overrides: [stored]))
        XCTAssertEqual(cover.rect(.medium), stored.rect, "the stored rectangle is where the frame starts")
        cover.zoom(.expanded, factor: 2)
        cover.zoom(.compact, factor: 2)
        let frames = cover.framing().overrides.map(\.frame)
        XCTAssertEqual(frames, framesOf(kind: .cover), "all three, in a fixed order")
        XCTAssertEqual(cover.framing().overrides.first { $0.frame == .medium }?.rect, stored.rect)
    }

    func testResetDropsEveryOverrideAndKeepsTheFocus() {
        let stored = FrameOverride(frame: .medium, rect: FrameRect(x: 0.1, y: 0.1, w: 0.5, h: 0.2))
        let cover = editor(.cover, current: .compact, base: Framing(focus: Focus(x: 0.3, y: 0.6), overrides: [stored]))
        cover.zoom(.compact, factor: 2)
        cover.resetToAutomatic()
        let framing = cover.framing()
        XCTAssertEqual(framing.overrides, [])
        XCTAssertEqual(framing.focus.x, 0.3, accuracy: 1e-9)
        XCTAssertEqual(framing.focus.y, 0.6, accuracy: 1e-9)
        XCTAssertNotEqual(cover.rect(.medium), stored.rect, "automatic again, placed by the focus")
    }

    func testTheCoverFrameFollowsTheWidthAndFallsBackToTheSizeClass() {
        XCTAssertEqual(coverFrame(width: 390, compactClass: nil), .compact)
        XCTAssertEqual(coverFrame(width: 700, compactClass: true), .medium)
        XCTAssertEqual(coverFrame(width: 1024, compactClass: true), .expanded)
        XCTAssertEqual(coverFrame(width: nil, compactClass: true), .compact)
        XCTAssertEqual(coverFrame(width: 0, compactClass: false), .expanded)
        XCTAssertEqual(coverFrame(width: nil, compactClass: nil), .expanded)
    }
}
