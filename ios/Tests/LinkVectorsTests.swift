import XCTest

@testable import Spjall

/// The links Android finds too, read from `api/link.vectors.json`. The core's test holds where each one goes.
final class LinkVectorsTests: XCTestCase {
    func testEveryLinkIsFoundAndOpensAsTheVectorsSay() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "link.vectors", withExtension: "json"))
        let vectors = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        let cases = try XCTUnwrap(vectors["cases"] as? [[String: Any]])
        XCTAssertFalse(cases.isEmpty)
        for vector in cases {
            let text = try XCTUnwrap(vector["text"] as? String)
            let want = try XCTUnwrap(vector["links"] as? [[String: Any]])
            let links = webLinks(text)
            let note = try XCTUnwrap(vector["note"] as? String)
            XCTAssertEqual(links.map(\.written), want.map { $0["written"] as? String ?? "" }, note)
            XCTAssertEqual(links.map(\.url.absoluteString), want.map { $0["opens"] as? String ?? "" }, note)
        }
    }
}
