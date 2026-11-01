import SpjallCore
import XCTest

@testable import Spjall

/// The cases in `api/poll.vectors.json`, which the server, the core, the web and Android read too (#494).
final class PollVectorsTests: XCTestCase {
    func testTheCoreFollowsEveryCase() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "poll.vectors", withExtension: "json"))
        let vectors = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        let cases = try XCTUnwrap(vectors["cases"] as? [[String: Any]])
        XCTAssertFalse(cases.isEmpty)
        for vector in cases {
            XCTAssertEqual(
                pollDraftValid(question: vector["question"] as! String, options: vector["options"] as! [String]),
                vector["valid"] as! Bool, vector["note"] as! String)
        }
    }

    func testAFieldKeepsCodePointsNotWhatIsDrawnAsOneCharacter() {
        let limit = CommunityModel.pollOptionLimit
        let emoji = String(repeating: "😀", count: limit + 1)
        XCTAssertEqual(CommunityModel.cappedPollOption(emoji).unicodeScalars.count, limit)
        let decomposed = String(repeating: "e\u{301}", count: limit)
        XCTAssertEqual(CommunityModel.cappedPollOption(decomposed).unicodeScalars.count, limit)
        XCTAssertEqual(CommunityModel.cappedPollOption("Já"), "Já")
    }
}
