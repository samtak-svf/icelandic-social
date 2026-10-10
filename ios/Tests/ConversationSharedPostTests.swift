import SpjallCore
import XCTest

@testable import Spjall

/// The card of a Fljótið post shared into a conversation (decision 0040).
@MainActor
final class ConversationSharedPostTests: XCTestCase {
    private let account = FakeAccount(signedIn: true)
    private lazy var live = FakeLive(account: account)
    private let sleeps = FakeSleep()
    private let anna = person("a2", "Anna")

    private func model() async -> ConversationModel {
        account.list = [conversation("c1", members: [anna])]
        let model = ConversationModel(id: "c1", account: account, live: live, sleep: sleeps.sleep)
        await model.load()
        return model
    }

    private func fetches(_ postId: String) -> Int {
        account.calls.filter { $0 == "sharedPost \(postId)" }.count
    }

    func testASharedPostIsFetchedOnceForTheScreen() async {
        let post = samplePost("p1", author: anna, body: "Góðan dag")
        account.posts = [post]
        let model = await model()
        await model.showPost("p1")
        await model.showPost("p1")
        XCTAssertEqual(model.posts["p1"], .found(post))
        XCTAssertEqual(fetches("p1"), 1)
    }

    func testAGonePostIsSaidOnceAndNotAskedForAgain() async {
        let model = await model()
        await model.showPost("p9")
        await model.showPost("p9")
        XCTAssertEqual(model.posts["p9"], .gone)
        XCTAssertEqual(fetches("p9"), 1)
    }

    func testAFailedFetchCanBeAskedForAgain() async {
        let post = samplePost("p1", author: anna)
        account.posts = [post]
        let model = await model()
        account.failNext = unreachable
        await model.showPost("p1")
        XCTAssertEqual(model.posts["p1"], .failed)
        await model.showPost("p1")
        XCTAssertEqual(model.posts["p1"], .found(post))
    }
}
