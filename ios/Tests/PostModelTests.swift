import SpjallCore
import XCTest

@testable import Spjall

@MainActor
final class PostModelTests: XCTestCase {
    private let social = FakeSocial()

    private func model(role: CommunityRole? = .member, state: ModerationState = .visible) async -> PostModel {
        social.communities = ["k1": makeCommunity("k1", "Fuglar", role: role)]
        social.posts = ["k1": [makePost("p1", "k1", comments: 3, state: state)]]
        social.comments = [
            "p1": [makeComment("c1", on: "p1"), makeComment("c2", on: "p1"), makeComment("c3", on: "p1")]
        ]
        let model = PostModel(social: social, postId: "p1", now: { FakeAccount.now })
        await model.load()
        return model
    }

    func testShowsThePostAndItsCommentsOldestFirstAPageAtATime() async {
        let model = await model()
        XCTAssertEqual(model.post?.postId, "p1")
        XCTAssertEqual(model.community?.name, "Fuglar")
        XCTAssertEqual(model.comments.map(\.commentId), ["c1", "c2"])
        await model.more()
        XCTAssertEqual(model.comments.map(\.commentId), ["c1", "c2", "c3"])
        XCTAssertNil(model.next)
    }

    func testACommentGoesLastOnceEveryPageIsShown() async {
        let model = await model()
        await model.more()
        model.draft = "Sammála"
        await model.publish()
        XCTAssertEqual(model.comments.last?.body, "Sammála")
        XCTAssertEqual(model.post?.commentCount, 4)
        XCTAssertEqual(model.draft, "")
    }

    func testACommentWaitsForItsPageWhileNewerOnesAreStillToCome() async {
        let model = await model()
        model.draft = "Sammála"
        await model.publish()
        XCTAssertEqual(model.comments.map(\.commentId), ["c1", "c2"])
        await model.more()
        XCTAssertEqual(model.comments.last?.body, "Sammála")
    }

    func testWhoeverIsNotAMemberReadsButDoesNotComment() async {
        let model = await model(role: nil)
        XCTAssertFalse(model.writes)
        model.draft = "Halló"
        XCTAssertFalse(model.sendable)
        await model.react(.like)
        XCTAssertFalse(social.calls.contains { $0.hasPrefix("react") })
    }

    func testAHiddenPostTakesNoReplies() async {
        let model = await model(role: .moderator, state: .hidden)
        XCTAssertFalse(model.writes)
    }

    func testAReactionTogglesOnThePost() async {
        let model = await model()
        await model.react(.wow)
        XCTAssertEqual(model.post?.myReaction, .wow)
        await model.react(.wow)
        XCTAssertNil(model.post?.myReaction)
        XCTAssertEqual(social.calls.suffix(2), ["react p1 wow", "unreact p1"])
    }

    func testAPostThatIsGoneIsAProblem() async {
        social.communities = ["k1": makeCommunity("k1", "Fuglar")]
        let model = PostModel(social: social, postId: "missing", now: { FakeAccount.now })
        await model.load()
        XCTAssertNil(model.post)
        XCTAssertNotNil(model.problem)
        XCTAssertTrue(model.loaded)
    }

    func testThisAccountsOwnPostIsDeletedAndTheScreenGoesBack() async {
        social.communities = ["k1": makeCommunity("k1", "Fuglar", role: .member)]
        social.posts = ["k1": [makePost("p1", "k1", author: jon)]]
        let model = PostModel(social: social, postId: "p1", now: { FakeAccount.now })
        await model.load()
        XCTAssertTrue(model.mine(jon))
        XCTAssertFalse(model.mine(anna))
        await model.deletePost()
        XCTAssertTrue(social.calls.contains("deletePost p1"))
        XCTAssertTrue(model.deleted)
    }

    func testAFailedDeleteStaysAndRetries() async {
        let model = await model()
        social.failNext = unreachable
        await model.deletePost()
        XCTAssertFalse(model.deleted)
        XCTAssertEqual(model.problem, .unreachable)
        await model.retry()
        XCTAssertTrue(model.deleted)
    }

    func testADeletedCommentLeavesAndThePostCountsOneFewer() async {
        social.comments = ["p1": [makeComment("c1", on: "p1", author: jon)]]
        let model = await modelKeepingComments()
        XCTAssertTrue(model.mine(model.comments[0].author))
        await model.deleteComment("c1")
        XCTAssertTrue(social.calls.contains("deleteComment c1"))
        XCTAssertEqual(model.comments, [])
        XCTAssertEqual(model.post?.commentCount, 2)
    }

    func testAReplyGoesUnderTheCommentItAnswers() async {
        let model = await model()
        model.reply(to: model.comments[0])
        XCTAssertEqual(model.replyingTo?.commentId, "c1")
        model.draft = "Sammála"
        await model.publish()
        XCTAssertTrue(social.calls.contains("createComment p1 Sammála on c1"))
        XCTAssertNil(model.replyingTo)
    }

    func testAThreadTakesOneLevelSoAReplyIsNotAnsweredAndATombstoneIsNotEither() async {
        social.comments = [
            "p1": [
                makeComment("c1", on: "p1"), makeComment("c2", on: "p1", parent: "c1"),
                makeComment("c3", on: "p1", body: "", state: .removed),
            ]
        ]
        let model = await modelKeepingComments()
        model.reply(to: model.comments[1])
        XCTAssertNil(model.replyingTo)
        await model.more()
        model.reply(to: model.comments[2])
        XCTAssertNil(model.replyingTo)
        model.reply(to: model.comments[0])
        XCTAssertEqual(model.replyingTo?.commentId, "c1")
    }

    func testCancellingAReplyWritesOnThePostItselfAgain() async {
        let model = await model()
        model.reply(to: model.comments[0])
        model.cancelReply()
        XCTAssertNil(model.replyingTo)
        model.draft = "Sammála"
        await model.publish()
        XCTAssertTrue(social.calls.contains("createComment p1 Sammála"))
        XCTAssertFalse(social.calls.contains { $0.contains(" on ") })
    }

    func testDeletingTheCommentBeingAnsweredStopsTheReply() async {
        social.comments = ["p1": [makeComment("c1", on: "p1", author: jon)]]
        let model = await modelKeepingComments()
        model.reply(to: model.comments[0])
        await model.deleteComment("c1")
        XCTAssertNil(model.replyingTo)
    }

    /// The post with three comments counted, and whichever comments the test set.
    private func modelKeepingComments() async -> PostModel {
        social.communities = ["k1": makeCommunity("k1", "Fuglar", role: .member)]
        social.posts = ["k1": [makePost("p1", "k1", comments: 3)]]
        let model = PostModel(social: social, postId: "p1", now: { FakeAccount.now })
        await model.load()
        return model
    }
}
