import Foundation
import XCTest

@testable import Spjall

/// A tapped notification: where it leads, and the thread its completion runs on.
@MainActor
final class NotificationTapTests: XCTestCase {
    func testATapWithACommunityOpensItsPost() {
        let model = PushModel(account: FakeAccount(signedIn: true), notifier: FakeNotifier())
        model.tapped(thread: "n1", community: "k1", post: "p1")
        XCTAssertEqual(model.takeOpenedSocial(), SocialTap(post: "p1", community: "k1"))
        XCTAssertNil(model.takeOpened())
    }

    func testATapOnANoticeWithNoCommunityIsNeverAConversation() {
        let model = PushModel(account: FakeAccount(signedIn: true), notifier: FakeNotifier())
        model.tapped(thread: "n1", community: nil, post: nil, notice: "n1")
        XCTAssertEqual(model.takeOpenedSocial(), SocialTap(post: nil, community: nil))
        XCTAssertNil(model.takeOpened())
    }

    func testATapWithoutACommunityOpensItsConversation() {
        let model = PushModel(account: FakeAccount(signedIn: true), notifier: FakeNotifier())
        model.tapped(thread: "c1", community: nil, post: nil)
        XCTAssertEqual(model.takeOpened(), "c1")
        XCTAssertNil(model.takeOpenedSocial())
    }

    /// UIKit aborts the app when a notification's completion handler runs off the main thread.
    func testTheWorkRunsOnTheMainThreadWhenAskedFromAnother() async {
        let done = expectation(description: "ran")
        DispatchQueue.global().async {
            onMainThread {
                XCTAssertTrue(Thread.isMainThread)
                done.fulfill()
            }
        }
        await fulfillment(of: [done], timeout: 2)
    }
}
