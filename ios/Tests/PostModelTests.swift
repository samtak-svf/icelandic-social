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
}
