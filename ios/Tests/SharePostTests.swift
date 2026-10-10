import SpjallCore
import XCTest

@testable import Spjall

/// "Senda í samtal": a Fljótið post sent through the conversation picker (decision 0040).
@MainActor
final class SharePostTests: XCTestCase {
    private let account = FakeAccount(signedIn: true)
    private lazy var live = FakeLive(account: account)

    private var shares: [String] { account.calls.filter { $0.hasPrefix("sharePost ") } }

    private func model() async -> PickModel {
        let model = PickModel.sharing("p1", account: account, live: live)
        await model.load()
        return model
    }

    func testEachPickedConversationGetsTheIdOfThePostThenOneSync() async {
        account.list = ["c1", "c2", "c3"].map { conversation($0, members: [person("a2")]) }
        let model = await model()
        // A post comes from no conversation, so every one is offered.
        XCTAssertEqual(model.conversations.map(\.id), ["c1", "c2", "c3"])
        model.toggle("c3")
        model.toggle("c1")
        await model.send()
        XCTAssertEqual(shares, ["sharePost c1 p1", "sharePost c3 p1"])
        XCTAssertEqual(live.performed, 1)
        XCTAssertEqual(model.done, 2)
    }

    func testAFailedShareKeepsWhatWasNotSentPickedAndSendsNothingTwice() async {
        account.list = ["c1", "c2"].map { conversation($0, members: [person("a2")]) }
        let model = await model()
        model.toggle("c1")
        model.toggle("c2")
        account.failOn = "sharePost c2 p1"
        await model.send()
        XCTAssertEqual(model.problem, .unreachable)
        XCTAssertEqual(model.picked, ["c2"])
        XCTAssertEqual(live.performed, 1)

        account.failOn = nil
        await model.send()
        XCTAssertEqual(shares, ["sharePost c1 p1", "sharePost c2 p1", "sharePost c2 p1"])
        XCTAssertEqual(model.done, 2)
    }
}
