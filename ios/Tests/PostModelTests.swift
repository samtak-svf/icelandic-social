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
        await model.react("👍")
        XCTAssertFalse(social.calls.contains { $0.hasPrefix("react") })
    }

    func testAMemberOfAReadOnlyCommunityReadsWhyThereIsNoCommentBox() async {
        let model = await model()
        social.communities = ["k1": makeCommunity("k1", "Fuglar", role: .member, readOnly: true)]
        await model.load()
        XCTAssertFalse(model.writes)
        XCTAssertEqual(model.noPostNotice, "community_read_only")
    }

    func testAHiddenPostTakesNoReplies() async {
        let model = await model(role: .moderator, state: .hidden)
        XCTAssertFalse(model.writes)
    }

    func testAReactionTogglesOnThePost() async {
        let model = await model()
        await model.react("😮")
        XCTAssertEqual(model.post?.myEmoji, "😮")
        await model.react("😮")
        XCTAssertNil(model.post?.myEmoji)
        XCTAssertEqual(social.calls.suffix(2), ["react p1 😮", "unreact p1"])
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

    func testTheCommentComposerKnowsTheReadersOwnNameAndPhoto() async {
        let model = await model()
        XCTAssertEqual(model.myName, "Jón Jónsson")
        XCTAssertNil(model.myPhoto)
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

    /// A picked image as a local copy, the way the picker hands one over.
    private func image(_ model: PostModel, _ name: String = "mynd.jpg") async throws -> String {
        let file = FileManager.default.temporaryDirectory.appending(path: "\(UUID().uuidString)-\(name)")
        try Data([1, 2, 3, 4]).write(to: file)
        await model.pick(Picked(mime: "image/jpeg", size: 4) { file })
        return try XCTUnwrap(model.image)
    }

    func testACommentOfAnImageAloneIsUploadedForThePostsCommunityAndSent() async throws {
        let model = await model()
        XCTAssertFalse(model.sendable)
        let path = try await image(model, "ein.jpg")
        XCTAssertTrue(model.sendable)
        await model.publish()
        XCTAssertTrue(social.calls.contains { $0.hasPrefix("uploadPostImage ") && $0.hasSuffix("ein.jpg") })
        XCTAssertTrue(social.calls.contains("createComment p1  media m-\(URL(filePath: path).lastPathComponent)"))
        XCTAssertEqual(social.comments["p1"]?.last?.images.count, 1)
        XCTAssertNil(model.image)
        XCTAssertFalse(FileManager.default.fileExists(atPath: path))
    }

    func testACommentOfTextAndAnImageGoesAsAReplyToo() async throws {
        let model = await model()
        model.reply(to: model.comments[0])
        _ = try await image(model)
        model.draft = "Sjáðu"
        await model.publish()
        XCTAssertTrue(social.calls.contains { $0.hasPrefix("createComment p1 Sjáðu on c1 media m-") })
    }

    func testAtMostOneImageAndASecondReplacesNothing() async throws {
        let model = await model()
        let first = try await image(model, "fyrsta.jpg")
        await model.pick(Picked(mime: "image/jpeg", size: 4) { throw CancellationError() })
        XCTAssertEqual(model.image, first)
        XCTAssertEqual(model.imageNotice, .tooMany)
        model.unpick()
        XCTAssertNil(model.image)
        XCTAssertNil(model.imageNotice)
        XCTAssertFalse(FileManager.default.fileExists(atPath: first))
    }

    func testAnImageOverTenMegabytesIsRefusedBeforeItIsRead() async {
        let model = await model()
        await model.pick(Picked(mime: "image/jpeg", size: CommunityModel.imageLimit + 1) { throw CancellationError() })
        XCTAssertEqual(model.imageNotice, .tooLarge)
        XCTAssertNil(model.image)
    }

    func testAFailedSendKeepsTheTextAndTheImageAndARetryDoesNotUploadAgain() async throws {
        let model = await model()
        let path = try await image(model)
        model.draft = "Sjáðu"
        social.failOn = "createComment"
        await model.publish()
        XCTAssertEqual(model.problem, .unreachable)
        XCTAssertEqual(model.draft, "Sjáðu")
        XCTAssertEqual(model.image, path)
        social.failOn = nil
        await model.retry()
        XCTAssertNil(model.image)
        XCTAssertEqual(social.calls.filter { $0.hasPrefix("uploadPostImage") }.count, 1)
    }

    func testAnImageTheServerRefusesIsNamedAndNothingIsSent() async throws {
        let model = await model()
        let path = try await image(model)
        social.refuseImage = CoreError.Refused(status: 415, code: "invalid_image", requestId: nil)
        await model.publish()
        XCTAssertEqual(model.imageNotice, .invalid)
        XCTAssertNil(model.problem)
        XCTAssertEqual(model.image, path)
        XCTAssertFalse(social.calls.contains { $0.hasPrefix("createComment") })
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

    func testALikeIsShownAtOnceAndTakenBackWithTheSameTap() async {
        let model = await model()
        await model.like("c1")
        XCTAssertTrue(social.calls.contains("likeComment c1"))
        XCTAssertEqual(model.comments.first?.liked, true)
        XCTAssertEqual(model.comments.first?.likes, 1)
        await model.like("c1")
        XCTAssertTrue(social.calls.contains("unlikeComment c1"))
        XCTAssertEqual(model.comments.first?.liked, false)
        XCTAssertEqual(model.comments.first?.likes, 0)
    }

    func testALikeTheServerRefusesIsPutBack() async {
        let model = await model()
        social.failNext = unreachable
        await model.like("c1")
        XCTAssertEqual(model.comments.first?.liked, false)
        XCTAssertEqual(model.comments.first?.likes, 0)
        XCTAssertNotNil(model.problem)
    }

    func testAReaderWhoMayNotWriteLikesNothing() async {
        let model = await model(role: nil)
        await model.like("c1")
        XCTAssertFalse(social.calls.contains("likeComment c1"))
    }

    func testARemovedCommentTakesNoLike() async {
        social.communities = ["k1": makeCommunity("k1", "Fuglar", role: .member)]
        social.posts = ["k1": [makePost("p1", "k1", comments: 1)]]
        social.comments = ["p1": [makeComment("c1", on: "p1", body: "", state: .removed)]]
        let model = PostModel(social: social, postId: "p1", now: { FakeAccount.now })
        await model.load()
        await model.like("c1")
        XCTAssertFalse(social.calls.contains("likeComment c1"))
    }

    func testAModeratorPinsThePostAndItIsShownPinned() async {
        let model = await model(role: .moderator)
        XCTAssertTrue(model.moderates)
        await model.pin(true)
        XCTAssertTrue(social.calls.contains("pinPost k1 p1"))
        XCTAssertEqual(model.post?.pinned, true)
        await model.pin(false)
        XCTAssertTrue(social.calls.contains("unpinPost k1 p1"))
        XCTAssertEqual(model.post?.pinned, false)
    }

    func testAMemberDoesNotPin() async {
        let model = await model()
        XCTAssertFalse(model.moderates)
        await model.pin(true)
        XCTAssertFalse(social.calls.contains("pinPost k1 p1"))
    }
}
