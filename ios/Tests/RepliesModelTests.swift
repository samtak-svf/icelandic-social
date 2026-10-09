import SpjallCore
import XCTest

@testable import Spjall

@MainActor
final class RepliesModelTests: XCTestCase {
    private let account = FakeAccount(signedIn: true)

    private func model() async -> RepliesModel {
        account.posts = [samplePost("p1", replies: 2)]
        account.postReplies = ["p1": [sampleReply("r1", postId: "p1"), sampleReply("r2", postId: "p1")]]
        let model = RepliesModel(account: account, postId: "p1")
        await model.load()
        return model
    }

    func testShowsThePostAndItsRepliesOldestFirst() async {
        let model = await model()
        XCTAssertTrue(model.loaded)
        XCTAssertEqual(model.post?.postId, "p1")
        XCTAssertEqual(model.replies.map(\.replyId), ["r1", "r2"])
        XCTAssertEqual(model.me, "a1")
    }

    func testAReplyEndsTheListAndABlankOneIsNotSent() async {
        let model = await model()
        let blank = await model.send(body: " ")
        XCTAssertFalse(blank)

        let sent = await model.send(body: "Sammála")
        XCTAssertTrue(sent)
        XCTAssertEqual(model.replies.last?.body, "Sammála")
        XCTAssertEqual(model.post?.replyCount, 3)
        XCTAssertEqual(account.calls.last, "createReply p1 Sammála")
    }

    func testDeletingAReplyTakesItOffTheList() async {
        let model = await model()
        await model.delete("r1")
        XCTAssertEqual(model.replies.map(\.replyId), ["r2"])
        XCTAssertEqual(model.post?.replyCount, 1)
        XCTAssertEqual(account.calls.last, "deleteReply r1")
    }

    func testAPostDeletedMeanwhileIsGone() async {
        let model = RepliesModel(account: account, postId: "missing")
        await model.load()
        XCTAssertTrue(model.gone)
        XCTAssertNil(model.problem)
        let sent = await model.send(body: "Halló")
        XCTAssertFalse(sent)
    }

    func testAHeartOnThePostTheServerRefusesIsPutBack() async {
        let model = await model()
        account.failNext = unreachable
        await model.toggleHeart()
        XCTAssertNil(model.post?.myReaction)
        XCTAssertEqual(model.problem, .unreachable)

        await model.toggleHeart()
        XCTAssertEqual(model.post?.myReaction, .heart)
        XCTAssertEqual(model.post?.reactions.heart, 1)
    }
}
