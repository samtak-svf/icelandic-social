import XCTest

@testable import Spjall

/// The links Android finds too, read from `api/link.vectors.json`. The core's test holds where each one goes.
final class LinkVectorsTests: XCTestCase {
    private func vectors() throws -> [String: Any] {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "link.vectors", withExtension: "json"))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    }

    /// What a person shares; the core's test reads each address back to its target.
    func testEveryAddressIsMintedAsTheVectorsSay() throws {
        let minted = try XCTUnwrap(vectors()["minted"] as? [[String: String]])
        XCTAssertFalse(minted.isEmpty)
        for vector in minted {
            let address = try XCTUnwrap(vector["address"])
            let id = try XCTUnwrap(vector["id"])
            let parts = try XCTUnwrap(URLComponents(string: address))
            let origin = "\(try XCTUnwrap(parts.scheme))://\(try XCTUnwrap(parts.host))"
            switch vector["kind"] {
            case "post": XCTAssertEqual(postLink(id, origin: origin), address)
            case "community": XCTAssertEqual(communityLink(id, origin: origin)?.absoluteString, address)
            default: XCTFail("no such screen: \(vector)")
            }
        }
    }

    func testEveryLinkIsFoundAndOpensAsTheVectorsSay() throws {
        let cases = try XCTUnwrap(vectors()["cases"] as? [[String: Any]])
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
