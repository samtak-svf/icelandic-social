import XCTest

@testable import Spjall

final class ImageViewerTests: XCTestCase {
    func testTheStartIndexIsClampedIntoTheImages() {
        XCTAssertEqual(ImageViewerState(count: 3, start: 1).index, 1)
        XCTAssertEqual(ImageViewerState(count: 3, start: 9).index, 2)
        XCTAssertEqual(ImageViewerState(count: 3, start: -4).index, 0)
        XCTAssertEqual(ImageViewerState(count: 0, start: 2).index, 0)
    }

    func testPagingChangesTheIndexWithinBounds() {
        var state = ImageViewerState(count: 3, start: 0)
        state.go(to: 2)
        XCTAssertEqual(state.index, 2)
        state.go(to: 7)
        XCTAssertEqual(state.index, 2)
        state.go(to: -1)
        XCTAssertEqual(state.index, 0)
    }

    func testZoomIsHeldWithinItsLimits() {
        var state = ImageViewerState(count: 1, start: 0)
        state.zoom(to: 99)
        XCTAssertEqual(state.scale, ImageViewerState.maxScale)
        state.zoom(to: 0.1)
        XCTAssertEqual(state.scale, 1)
        XCTAssertFalse(state.isZoomed)
    }

    func testADoubleTapZoomsInThenBackOut() {
        var state = ImageViewerState(count: 1, start: 0)
        state.toggleZoom()
        XCTAssertTrue(state.isZoomed)
        state.toggleZoom()
        XCTAssertFalse(state.isZoomed)
    }

    func testZoomResetsWhenPaging() {
        var state = ImageViewerState(count: 3, start: 0)
        state.zoom(to: 3)
        state.go(to: 1)
        XCTAssertEqual(state.scale, 1)
        XCTAssertEqual(state.index, 1)
    }

    func testStayingOnThePageKeepsTheZoom() {
        var state = ImageViewerState(count: 3, start: 1)
        state.zoom(to: 3)
        state.go(to: 1)
        XCTAssertEqual(state.scale, 3)
    }

    func testOpeningAtAnImageNamesItsIndexAndClampsIt() {
        XCTAssertEqual(ImageViewerOpening(index: 1, count: 3).index, 1)
        XCTAssertEqual(ImageViewerOpening(index: 5, count: 3).index, 2)
    }
}
