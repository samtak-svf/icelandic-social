import SwiftUI
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

    /// Writes the byline of a long verified name to `SPJALL_SNAPSHOT_DIR`, to look at; skipped without it.
    func testWritesALongNameBylineWhenAsked() throws {
        guard let dir = ProcessInfo.processInfo.environment["SPJALL_SNAPSHOT_DIR"] else {
            throw XCTSkip("SPJALL_SNAPSHOT_DIR is not set")
        }
        let view = HStack(spacing: 10) {
            Circle().fill(.gray).frame(width: 34, height: 34)
            VStack(alignment: .leading, spacing: 2) {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 4) { sample }
                    VStack(alignment: .leading, spacing: 2) { sample }
                }
            }
        }
        .padding(16)
        .frame(width: 393, alignment: .leading)
        .background(Color.white)
        let renderer = ImageRenderer(content: view)
        renderer.scale = 3
        let png = try XCTUnwrap(renderer.uiImage?.pngData())
        try png.write(to: URL(fileURLWithPath: dir).appendingPathComponent("longname.png"))
    }

    @ViewBuilder private var sample: some View {
        NameWithMark(
            name: "Anna Margrét Sigurbjörnsdóttir Kristjánsdóttir", verified: true, markSize: 12,
            font: .sans(14, black: true))
        RoleBadge(role: .owner)
    }
}
