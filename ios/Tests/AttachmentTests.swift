import SpjallCore
import SwiftUI
import XCTest

@testable import Spjall

/// Which messages reach their bubble's edges, and which have no frame at all (0053).
final class AttachmentTests: XCTestCase {
    private let photo = item(1, content: .media(mime: "image/jpeg", size: 10, caption: nil, name: nil))
    private let captioned = item(2, content: .media(mime: "image/jpeg", size: 10, caption: "Esjan", name: nil))
    private let file = item(3, content: .media(mime: "application/pdf", size: 10, caption: nil, name: "skýrsla.pdf"))

    func testAPhotoFillsItsBubbleWhileItLoadsAndOnceReady() {
        XCTAssertTrue(photo.edgeToEdge(nil))
        XCTAssertTrue(photo.edgeToEdge(.loading))
        XCTAssertTrue(captioned.edgeToEdge(.ready("/p.jpg")))
    }

    func testAFileAFailedPhotoAndTextKeepThePaddedBubble() {
        XCTAssertFalse(file.edgeToEdge(.ready("/f.pdf")))
        XCTAssertFalse(photo.edgeToEdge(.failed))
        XCTAssertFalse(item(4).edgeToEdge(nil))
    }

    func testOnlyAPhotoWithNothingRoundItIsBare() {
        XCTAssertTrue(photo.bare(nil))
        XCTAssertFalse(captioned.bare(nil), "a caption sits in the bubble's colour")
        XCTAssertFalse(item(5, content: photo.content, forwarded: true).bare(nil), "the forwarded mark does too")
        XCTAssertFalse(photo.bare(.failed))
    }

    func testAPhotoIsDrawnAtItsOwnShapeSoTheBubbleEndsAtItsEdge() {
        let tall = UIGraphicsImageRenderer(size: CGSize(width: 90, height: 120)).image { _ in }
        let wide = UIGraphicsImageRenderer(size: CGSize(width: 120, height: 90)).image { _ in }
        let room = CGSize(width: 400, height: 800)
        XCTAssertEqual(
            UIHostingController(rootView: PhotoImage(image: tall, longest: 240)).sizeThatFits(in: room),
            CGSize(width: 180, height: 240)
        )
        XCTAssertEqual(
            UIHostingController(rootView: PhotoImage(image: wide, longest: 240)).sizeThatFits(in: room),
            CGSize(width: 240, height: 180)
        )
    }
}
