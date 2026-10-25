import SpjallCore
import XCTest

@testable import Spjall

@MainActor
final class AnonymousQueueModelTests: XCTestCase {
    private let social = FakeSocial()

    private func model(waiting: Int = 3) async -> AnonymousQueueModel {
        social.pending = [
            "k1": (1...waiting).reversed().map {
                makePost("q\($0)", "k1", body: "Bíður \($0)", author: nil, anonymous: true, state: .pending)
            }
        ]
        social.authors = ["q3": Author(accountId: "a9", name: "Gunna", verified: false)]
        let model = AnonymousQueueModel(social: social, communityId: "k1")
        await model.load()
        return model
    }

    func testTheQueueListsTheWaitingPostsNewestFirstAPageAtATime() async {
        let model = await model()
        XCTAssertTrue(model.loaded)
        XCTAssertEqual(model.posts.map(\.postId).first, "q3")
        XCTAssertTrue(social.calls.contains("pendingAnonymousPosts k1 -"))
    }

    func testApprovingAPostTakesItOffTheQueue() async {
        let model = await model()
        await model.approve(model.posts[0])
        XCTAssertTrue(social.calls.contains("approveAnonymousPost q3"))
        XCTAssertFalse(model.posts.contains { $0.postId == "q3" })
        XCTAssertNil(model.problem)
        XCTAssertNil(model.answering)
    }

    func testDecliningAPostTakesItOffTheQueue() async {
        let model = await model()
        await model.decline(model.posts[0])
        XCTAssertTrue(social.calls.contains("declineAnonymousPost q3"))
        XCTAssertFalse(model.posts.contains { $0.postId == "q3" })
    }

    func testRevealingAPostKeepsItAndRemembersTheName() async {
        let model = await model()
        await model.reveal(model.posts[0])
        XCTAssertTrue(social.calls.contains("revealAuthor q3"))
        XCTAssertEqual(model.revealed["q3"]?.name, "Gunna")
        XCTAssertTrue(model.posts.contains { $0.postId == "q3" })
    }

    func testARefusedRevealShowsAProblemAndRetries() async {
        let model = await model()
        await model.reveal(model.posts[1])
        XCTAssertNotNil(model.problem)
        XCTAssertNil(model.revealed["q2"])
        social.authors = ["q2": Author(accountId: "a8", name: "Siggi", verified: false)]
        await model.retry()
        XCTAssertEqual(model.revealed["q2"]?.name, "Siggi")
    }
}
