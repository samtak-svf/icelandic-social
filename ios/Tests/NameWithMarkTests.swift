import XCTest

@testable import Spjall

@MainActor
final class NameWithMarkTests: XCTestCase {
    func testTheMarkImageIsCachedPerSizeAndScale() {
        let first = VerifiedMarkImage.image(size: 12, scale: 3)
        XCTAssertTrue(first === VerifiedMarkImage.image(size: 12, scale: 3))
        XCTAssertFalse(first === VerifiedMarkImage.image(size: 11, scale: 3))
        XCTAssertFalse(first === VerifiedMarkImage.image(size: 12, scale: 2))
    }

    func testTheMarkImageIsAsLargeAsAskedInPoints() {
        let image = VerifiedMarkImage.image(size: 12, scale: 3)
        XCTAssertEqual(image.size, CGSize(width: 12, height: 12))
        XCTAssertEqual(image.scale, 3)
    }
}
