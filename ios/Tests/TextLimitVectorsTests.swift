import XCTest

@testable import Spjall

/// The count every platform shares, read from `api/text-length.vectors.json`.
final class TextLimitVectorsTests: XCTestCase {
    private func vectors() throws -> [String: Any] {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "text-length.vectors", withExtension: "json"))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    }

    func testEveryTextCountsAsTheVectorsSay() throws {
        let cases = try XCTUnwrap(vectors()["lengths"] as? [[String: Any]])
        XCTAssertFalse(cases.isEmpty)
        for vector in cases {
            let text = try XCTUnwrap(vector["text"] as? String)
            let want = try XCTUnwrap(vector["codePoints"] as? Int)
            let note = try XCTUnwrap(vector["note"] as? String)
            XCTAssertEqual(textLength(text), want, note)
        }
    }

    func testEveryTextClipsAsTheVectorsSay() throws {
        let cases = try XCTUnwrap(vectors()["clips"] as? [[String: Any]])
        XCTAssertFalse(cases.isEmpty)
        for vector in cases {
            let text = try XCTUnwrap(vector["text"] as? String)
            let limit = try XCTUnwrap(vector["limit"] as? Int)
            let want = try XCTUnwrap(vector["clipped"] as? String)
            let note = try XCTUnwrap(vector["note"] as? String)
            // Compared by scalars: Swift's == treats canonically equal strings as the same.
            XCTAssertEqual(Array(clippedText(text, to: limit).unicodeScalars), Array(want.unicodeScalars), note)
        }
    }
}
