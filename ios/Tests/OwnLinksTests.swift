import SwiftUI
import XCTest

@testable import Spjall

/// A link on our own host opens its screen; anything else goes to the system (decision 0121). The core reads the link.
final class OwnLinksTests: XCTestCase {
    private func route(_ link: String) -> SocialRoute? { SocialRoute(ownLink: URL(string: link)!) }

    func testAPostAndACommunityHaveTheirScreens() {
        XCTAssertEqual(route("https://spjall.samtak.is/posts/p1"), .post("p1"))
        XCTAssertEqual(route("https://spjall.samtak.is/communities/c1"), .community("c1"))
    }

    func testAnythingElseHasNone() {
        XCTAssertNil(route("https://spjall.samtak.is/communities/new"))
        XCTAssertNil(route("https://spjall.samtak.is/communities/c1/members"))
        XCTAssertNil(route("https://example.com/posts/p1"))
    }

    func testTheConversationsRoutesAreOneColumn() {
        XCTAssertFalse(SocialRoute.people.wide)
        XCTAssertFalse(SocialRoute.conversation("c1").wide)
    }

    func testAPageNoScreenStandsForGoesToTheBrowserOnce() {
        var handoff = BrowserHandoff()
        let page = URL(string: "https://spjall.samtak.is/posts/p1?a=b")!
        XCTAssertTrue(handoff.opens(page))
        XCTAssertFalse(handoff.opens(page))
        XCTAssertTrue(handoff.opens(page))
        XCTAssertFalse(handoff.opens(URL(string: "spjall://callback")!))
    }
}
