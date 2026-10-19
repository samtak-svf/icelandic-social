import SpjallCore
import XCTest

@testable import Spjall

@MainActor
final class CommunityModelTests: XCTestCase {
    private let social = FakeSocial()

    private func model(_ community: Community) async -> CommunityModel {
        social.communities = [community.communityId: community]
        social.posts = [
            community.communityId: [
                makePost("p3", community.communityId), makePost("p2", community.communityId),
                makePost("p1", community.communityId),
            ]
        ]
        let model = CommunityModel(social: social, communityId: community.communityId, now: { FakeAccount.now })
        await model.load()
        return model
    }

    func testAMemberReadsThePostsNewestFirstAPageAtATime() async {
        let model = await model(makeCommunity("k1", "Fuglar", role: .member))
        XCTAssertTrue(model.reads)
        XCTAssertTrue(model.writes)
        XCTAssertEqual(model.posts.map(\.postId), ["p3", "p2"])
        await model.more()
        XCTAssertEqual(model.posts.map(\.postId), ["p3", "p2", "p1"])
        XCTAssertNil(model.next)
    }

    func testAnOpenCommunityIsReadButNotWrittenBeforeJoining() async {
        let model = await model(makeCommunity("k1", "Fuglar"))
        XCTAssertTrue(model.reads)
        XCTAssertFalse(model.writes)
        XCTAssertEqual(model.posts.count, 2)
        model.draft = "Halló"
        XCTAssertFalse(model.sendable)
    }

    func testAPrivateCommunityShowsNoPostsToWhoeverIsNotIn() async {
        let model = await model(makeCommunity("k1", "Fiskar", audience: .private))
        XCTAssertFalse(model.reads)
        XCTAssertEqual(model.posts, [])
        XCTAssertFalse(social.calls.contains { $0.hasPrefix("communityPosts") })
    }

    func testJoiningAnOpenCommunityMakesAMemberWhoWrites() async {
        let model = await model(makeCommunity("k1", "Fuglar"))
        await model.join()
        XCTAssertEqual(model.community?.role, .member)
        XCTAssertTrue(model.writes)
    }

    func testJoiningAPrivateCommunityAsksAndWaits() async {
        let model = await model(makeCommunity("k1", "Fiskar", audience: .private))
        await model.join()
        XCTAssertEqual(model.community?.joinRequested, true)
        XCTAssertNil(model.community?.role)
        XCTAssertFalse(model.reads)
    }

    func testLeavingAPrivateCommunityTakesThePostsAway() async {
        let model = await model(makeCommunity("k1", "Fiskar", audience: .private, role: .member))
        XCTAssertEqual(model.posts.count, 2)
        await model.leave()
        XCTAssertNil(model.community?.role)
        XCTAssertEqual(model.posts, [])
    }

    func testAMutedMemberReadsButDoesNotWrite() async {
        let model = await model(makeCommunity("k1", "Fuglar", role: .member, mutedUntil: FakeAccount.now + 60_000))
        XCTAssertTrue(model.muted)
        XCTAssertFalse(model.writes)
        XCTAssertEqual(model.posts.count, 2)
    }

    func testAPublishedPostGoesOnTopAndTheDraftEmpties() async {
        let model = await model(makeCommunity("k1", "Fuglar", role: .member))
        model.draft = "  Fyrsti lóan  "
        XCTAssertTrue(model.sendable)
        await model.publish()
        XCTAssertEqual(model.posts.first?.body, "Fyrsti lóan")
        XCTAssertEqual(model.draft, "")
        XCTAssertTrue(social.calls.contains("createPost k1 Fyrsti lóan"))
    }

    func testAFailedPostKeepsTheDraft() async {
        let model = await model(makeCommunity("k1", "Fuglar", role: .member))
        model.draft = "Halló"
        social.failNext = unreachable
        await model.publish()
        XCTAssertEqual(model.draft, "Halló")
        XCTAssertEqual(model.problem, .unreachable)
    }

    func testAReactionTogglesAndTheSecondTapTakesItOff() async {
        let model = await model(makeCommunity("k1", "Fuglar", role: .member))
        await model.react("p2", .love)
        XCTAssertEqual(model.posts[1].myReaction, .love)
        XCTAssertEqual(reactionCount(model.posts[1], .love), 1)
        await model.react("p2", .love)
        XCTAssertNil(model.posts[1].myReaction)
        XCTAssertEqual(social.calls.suffix(2), ["react p2 love", "unreact p2"])
    }

    func testARefusedReactionPutsThePostBack() async {
        let model = await model(makeCommunity("k1", "Fuglar", role: .member))
        let before = model.posts[0]
        social.failNext = unreachable
        await model.react("p3", .like)
        XCTAssertEqual(model.posts[0], before)
        XCTAssertEqual(model.problem, .unreachable)
    }

    func testOnlyAModeratorSeesTheQueue() async {
        let member = await model(makeCommunity("k1", "Fuglar", role: .member))
        XCTAssertFalse(member.moderates)
        let moderator = await model(makeCommunity("k2", "Fuglar", role: .moderator))
        XCTAssertTrue(moderator.moderates)
        let owner = await model(makeCommunity("k3", "Fuglar", role: .owner))
        XCTAssertTrue(owner.moderates)
    }

    func testARefreshTakesTheNewCountsAndANewerPost() async {
        let model = await model(makeCommunity("k1", "Fuglar", role: .member))
        social.posts = ["k1": [makePost("p4", "k1"), makePost("p3", "k1", comments: 5), makePost("p2", "k1")]]
        await model.refresh()
        XCTAssertEqual(model.posts.map(\.postId), ["p4", "p3", "p2"])
        XCTAssertEqual(model.posts[1].commentCount, 5)
    }

    func testARequestToJoinIsTakenBack() async {
        var waiting = makeCommunity("k1", "Fiskar", audience: .private)
        waiting.joinRequested = true
        let model = await model(waiting)
        await model.withdraw()
        XCTAssertTrue(social.calls.contains("withdrawJoinRequest k1"))
        XCTAssertEqual(model.community?.joinRequested, false)
        XCTAssertNil(model.problem)
    }

    func testOnlyThisAccountsOwnPostIsDeletedAndLeavesTheList() async {
        let community = makeCommunity("k1", "Fuglar", role: .member)
        social.communities = ["k1": community]
        social.posts = ["k1": [makePost("p2", "k1", author: jon), makePost("p1", "k1")]]
        let model = CommunityModel(social: social, communityId: "k1", now: { FakeAccount.now })
        await model.load()
        XCTAssertTrue(model.mine(model.posts[0].author))
        XCTAssertFalse(model.mine(model.posts[1].author))
        await model.delete("p2")
        XCTAssertTrue(social.calls.contains("deletePost p2"))
        XCTAssertEqual(model.posts.map(\.postId), ["p1"])
    }

    func testAPostDeletedElsewhereLeavesOnRefresh() async {
        let model = await model(makeCommunity("k1", "Fuglar", role: .member))
        await model.more()
        social.posts = ["k1": [makePost("p3", "k1"), makePost("p1", "k1")]]
        await model.refresh()
        XCTAssertEqual(model.posts.map(\.postId), ["p3", "p1"])
    }

    /// An image picked, as a file of its own, the size the picker says.
    private func image(_ model: CommunityModel, _ name: String = UUID().uuidString) async throws -> String {
        let file = FileManager.default.temporaryDirectory.appending(path: name)
        try Data("jpeg".utf8).write(to: file)
        await model.pick(Picked(mime: "image/jpeg", size: 4) { file })
        return file.path
    }

    func testPickedImagesAreUploadedAndGoWithThePost() async throws {
        let model = await model(makeCommunity("k1", "Fuglar", role: .member))
        let first = try await image(model, "fyrsta.jpg")
        let second = try await image(model, "onnur.jpg")
        XCTAssertEqual(model.images, [first, second])
        model.draft = "Lóan"
        await model.publish()
        XCTAssertTrue(social.calls.contains("uploadPostImage k1 fyrsta.jpg"))
        XCTAssertTrue(social.calls.contains("uploadPostImage k1 onnur.jpg"))
        XCTAssertTrue(social.calls.contains("createPost k1 Lóan m-fyrsta.jpg,m-onnur.jpg"))
        XCTAssertEqual(model.posts.first?.images.map(\.mediaId), ["m-fyrsta.jpg", "m-onnur.jpg"])
        XCTAssertEqual(model.images, [])
        XCTAssertFalse(FileManager.default.fileExists(atPath: first))
    }

    func testAPostOfAnImageAloneIsSent() async throws {
        let model = await model(makeCommunity("k1", "Fuglar", role: .member))
        XCTAssertFalse(model.sendable)
        _ = try await image(model, "ein.jpg")
        XCTAssertTrue(model.sendable)
        await model.publish()
        XCTAssertTrue(social.calls.contains("createPost k1  m-ein.jpg"))
    }

    func testAFifthImageIsRefused() async throws {
        let model = await model(makeCommunity("k1", "Fuglar", role: .member))
        for _ in 0..<CommunityModel.imageCount { _ = try await image(model) }
        XCTAssertEqual(model.images.count, 4)
        XCTAssertNil(model.imageNotice)
        XCTAssertEqual(model.imagesLeft, 0)
        XCTAssertFalse(model.roomForImage())
        XCTAssertEqual(model.imageNotice, .tooMany)
        await model.pick(Picked(mime: "image/jpeg", size: 4) { throw CancellationError() })
        XCTAssertEqual(model.images.count, 4)
        model.unpick(model.images[0])
        XCTAssertEqual(model.images.count, 3)
        XCTAssertNil(model.imageNotice)
        XCTAssertTrue(model.roomForImage())
    }

    func testAnImageOverTenMegabytesIsRefusedBeforeItIsRead() async {
        let model = await model(makeCommunity("k1", "Fuglar", role: .member))
        await model.pick(Picked(mime: "image/jpeg", size: CommunityModel.imageLimit + 1) { throw CancellationError() })
        XCTAssertEqual(model.imageNotice, .tooLarge)
        XCTAssertEqual(model.images, [])
    }

    func testAnImageTheServerRefusesIsNamedAndNothingIsPosted() async throws {
        let model = await model(makeCommunity("k1", "Fuglar", role: .member))
        _ = try await image(model)
        social.refuseImage = CoreError.Refused(status: 415, code: "invalid_image", requestId: nil)
        await model.publish()
        XCTAssertEqual(model.imageNotice, .invalid)
        XCTAssertNil(model.problem)
        XCTAssertEqual(model.images.count, 1)
        XCTAssertFalse(social.calls.contains { $0.hasPrefix("createPost") })
    }
}
