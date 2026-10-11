import XCTest

@testable import Spjall

final class MotionTests: XCTestCase {
    func testRowsAnimateUnlessMotionIsReduced() {
        XCTAssertNotNil(Motion.rows(reduceMotion: false))
        XCTAssertNil(Motion.rows(reduceMotion: true))
    }

    func testPlaceholdersPulseUnlessMotionIsReduced() {
        XCTAssertTrue(Motion.pulses(reduceMotion: false))
        XCTAssertFalse(Motion.pulses(reduceMotion: true))
    }
}
