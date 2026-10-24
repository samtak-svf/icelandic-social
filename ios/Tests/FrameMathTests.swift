import SpjallCore
import XCTest

@testable import Spjall

/// The crop editor's maths (decision 0086): a gesture moves a rectangle of the image and the rectangle gives the focus.
final class FrameMathTests: XCTestCase {
    private let image = FrameMath.ImageSize(w: 2400, h: 1200)
    private let wide = FrameMath.Aspect(w: 3, h: 1)
    private let square = FrameMath.Aspect(w: 1, h: 1)

    func testTheWholeFrameIsTheLargestRectangleOfItsShapeInTheMiddle() {
        let whole = FrameMath.whole(image, wide)
        XCTAssertEqual(whole.x, 0, accuracy: 0.001)
        XCTAssertEqual(whole.w, 1, accuracy: 0.001)
        XCTAssertEqual(whole.h, 800.0 / 1200.0, accuracy: 0.001)
        XCTAssertEqual(whole.y, 0.5 - whole.h / 2, accuracy: 0.001)
        let tall = FrameMath.whole(image, square)
        XCTAssertEqual(tall.w, 0.5, accuracy: 0.001, "1200 of 2400 across")
        XCTAssertEqual(tall.h, 1, accuracy: 0.001)
    }

    func testAStoredRectangleWinsOverTheFocus() {
        let stored = FrameRect(x: 0.1, y: 0.2, w: 0.5, h: 0.2)
        let start = FrameMath.start(image, wide, focus: Focus(x: 0.9, y: 0.9), stored: stored)
        XCTAssertEqual(start, stored)
    }

    func testTheFocusPlacesTheStartAndNeverLeavesTheImage() {
        let start = FrameMath.start(image, square, focus: Focus(x: 1, y: 0.5), stored: nil)
        XCTAssertEqual(start.x + start.w, 1, accuracy: 0.001, "a focus at the edge is held inside")
        XCTAssertLessThanOrEqual(start.x + start.w, 1)
    }

    func testADragMovesTheWindowAgainstTheFingerByTheShareOfTheViewport() {
        let rect = FrameRect(x: 0.4, y: 0.3, w: 0.2, h: 0.2)
        let moved = FrameMath.drag(rect, dx: 50, dy: -20, viewport: CGSize(width: 100, height: 100))
        XCTAssertEqual(moved.x, 0.4 - 0.5 * 0.2, accuracy: 1e-9)
        XCTAssertEqual(moved.y, 0.3 + 0.2 * 0.2, accuracy: 1e-9)
        XCTAssertEqual([moved.w, moved.h], [0.2, 0.2], "a drag never changes the shape")
    }

    func testADragIsClampedInsideTheImage() {
        let rect = FrameRect(x: 0.4, y: 0.3, w: 0.2, h: 0.2)
        let far = FrameMath.drag(rect, dx: 10_000, dy: 10_000, viewport: CGSize(width: 100, height: 100))
        XCTAssertEqual([far.x, far.y], [0, 0])
        let other = FrameMath.drag(rect, dx: -10_000, dy: -10_000, viewport: CGSize(width: 100, height: 100))
        XCTAssertLessThanOrEqual(other.x + other.w, 1)
        XCTAssertLessThanOrEqual(other.y + other.h, 1)
        XCTAssertEqual(other.x, 0.8, accuracy: 1e-9)
    }

    func testADragInAnEmptyViewportDoesNothing() {
        let rect = FrameRect(x: 0.4, y: 0.3, w: 0.2, h: 0.2)
        XCTAssertEqual(FrameMath.drag(rect, dx: 5, dy: 5, viewport: .zero), rect)
    }

    func testZoomingInKeepsThePointUnderTheAnchorAndTheShape() {
        let whole = FrameMath.whole(image, wide)
        let zoomed = FrameMath.zoomed(whole, image: image, aspect: wide, factor: 2, anchorX: 0.25, anchorY: 0.5)
        XCTAssertEqual(zoomed.w, whole.w / 2, accuracy: 1e-9)
        XCTAssertEqual(zoomed.w * 2400 / (zoomed.h * 1200), 3, accuracy: 1e-6, "still 3:1")
        XCTAssertEqual(zoomed.x + 0.25 * zoomed.w, whole.x + 0.25 * whole.w, accuracy: 1e-9)
        XCTAssertEqual(FrameMath.zoom(of: zoomed, whole: whole), 2, accuracy: 1e-9)
    }

    func testZoomIsHeldBetweenTheWholeFrameAndEightTimesIn() {
        let whole = FrameMath.whole(image, square)
        let out = FrameMath.zoomed(whole, image: image, aspect: square, factor: 0.1, anchorX: 0.5, anchorY: 0.5)
        XCTAssertEqual(out.w, whole.w, accuracy: 1e-9, "never wider than the whole frame")
        let far = FrameMath.zoomed(whole, image: image, aspect: square, factor: 1000, anchorX: 0.5, anchorY: 0.5)
        XCTAssertEqual(far.w, whole.w / FrameMath.maxZoom, accuracy: 1e-9)
        XCTAssertEqual(FrameMath.zoomed(whole, image: image, aspect: square, factor: 0, anchorX: 0, anchorY: 0), whole)
        XCTAssertEqual(
            FrameMath.zoomed(whole, image: image, aspect: square, factor: .nan, anchorX: 0, anchorY: 0), whole)
    }

    func testTheFocusIsTheCentreOfTheRectangle() {
        let focus = FrameMath.focus(of: FrameRect(x: 0.2, y: 0.1, w: 0.4, h: 0.6))
        XCTAssertEqual(focus.x, 0.4, accuracy: 1e-9)
        XCTAssertEqual(focus.y, 0.4, accuracy: 1e-9)
    }

    func testASettledRectangleNeverPassesTheEdgeTheContractRefuses() {
        let rect = FrameMath.settle(0.7, 0.9, 0.3, 0.1)
        XCTAssertLessThanOrEqual(rect.x + rect.w, 1)
        XCTAssertLessThanOrEqual(rect.y + rect.h, 1)
        XCTAssertGreaterThanOrEqual(rect.x, 0)
    }
}
