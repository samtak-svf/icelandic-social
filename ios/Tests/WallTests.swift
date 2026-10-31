import SpjallCore
import XCTest

@testable import Spjall

/// An account's wall (decision 0115): the bio, the posts, the audience, and a wall post's screen.
@MainActor
final class WallTests: XCTestCase {
    private let social = FakeSocial()

    private func wall(_ account: String = "a1") async -> WallModel {
        let model = WallModel(social: social, accountId: account)
        await model.load()
        return model
    }

    private func wallPost(_ id: String, owner: String = "a1", audience: WallAudience = .friends) -> Post {
        var post = makePost(id, "w-\(owner)", body: "Á veggnum", author: jon)
        post.wallOwner = owner
        post.audience = audience
        return post
    }

    func testTheWallLoadsItsProfileAndPostsAndPagesThem() async {
        social.walls.bios["a1"] = "Ég bý hér"
        social.walls.posts["a1"] = (1...3).map { wallPost("w\($0)") }
        let model = await wall()
        XCTAssertEqual(model.wall?.bio, "Ég bý hér")
        XCTAssertEqual(model.posts.map(\.postId), ["w1", "w2"])
        await model.more()
        XCTAssertEqual(model.posts.map(\.postId), ["w1", "w2", "w3"])
        XCTAssertNil(model.next)
    }

    func testAWallWithoutAProfileStillListsItsPosts() async {
        social.walls.posts["a1"] = [wallPost("w1")]
        social.failOn = "wall"
        let model = await wall()
        XCTAssertNil(model.wall)
        XCTAssertEqual(model.posts.map(\.postId), ["w1"])
    }

    func testTheBioIsCleanedAndAnEmptyOneClears() async {
        social.walls.bios["a1"] = "Gamalt"
        let model = await wall()
        model.editBio()
        model.bioDraft = "  Lína eitt\nlína tvö  "
        await model.saveBio()
        XCTAssertTrue(social.calls.contains("setBio Lína eitt lína tvö"))
        XCTAssertEqual(model.wall?.bio, "Lína eitt lína tvö")
        XCTAssertNil(model.bioDraft)
        model.editBio()
        model.bioDraft = "   "
        await model.saveBio()
        XCTAssertNil(model.wall?.bio)
        XCTAssertNil(social.walls.bios["a1"])
    }

    func testABioOverTheLimitIsNotSent() async {
        let model = await wall()
        model.editBio()
        model.bioDraft = String(repeating: "á", count: WallModel.bioLimit + 1)
        XCTAssertFalse(model.bioFits)
        await model.saveBio()
        XCTAssertFalse(social.calls.contains { $0.hasPrefix("setBio") })
        model.bioDraft = String(repeating: "á", count: WallModel.bioLimit)
        XCTAssertTrue(model.bioFits)
    }

    func testPublishingPutsThePostFirstWithTheChosenAudience() async {
        social.walls.posts["a1"] = [wallPost("w1")]
        let model = await wall()
        model.audience = .everyone
        model.draft = "  Nýtt  "
        await model.publish()
        XCTAssertTrue(social.calls.contains { $0.hasPrefix("createWallPost Nýtt everyone") })
        XCTAssertEqual(model.posts.first?.body, "Nýtt")
        XCTAssertEqual(model.posts.first?.audience, .everyone)
        XCTAssertEqual(model.draft, "")
    }

    func testABlankDraftIsNotPublished() async {
        let model = await wall()
        model.draft = "   "
        XCTAssertFalse(model.publishable)
        await model.publish()
        XCTAssertFalse(social.calls.contains { $0.hasPrefix("createWallPost") })
    }

    func testAFailedPostKeepsTheDraftAndRetries() async {
        let model = await wall()
        model.draft = "Nýtt"
        social.failOn = "createWallPost"
        await model.publish()
        XCTAssertNotNil(model.problem)
        XCTAssertEqual(model.draft, "Nýtt")
        social.failOn = nil
        await model.retry()
        XCTAssertEqual(model.draft, "")
        XCTAssertEqual(model.posts.count, 1)
    }

    func testTheAudienceOfAPostChangesOnTheServerAndInTheList() async {
        social.walls.posts["a1"] = [wallPost("w1")]
        let model = await wall()
        await model.setAudience("w1", .everyone)
        XCTAssertTrue(social.calls.contains("setPostAudience w1 everyone"))
        XCTAssertEqual(model.posts.first?.audience, .everyone)
    }

    func testTheImagesPageSeparately() async {
        social.walls.images["a1"] = (1...3).map {
            CommunityImage(
                mediaId: "m\($0)", postId: "p\($0)", commentId: nil, width: 4, height: 3, createdAt: UInt64($0))
        }
        let model = await wall()
        await model.loadImages()
        XCTAssertEqual(model.images.map(\.mediaId), ["m1", "m2"])
        await model.moreImages()
        XCTAssertEqual(model.images.map(\.mediaId), ["m1", "m2", "m3"])
    }

    // MARK: a wall post's screen

    private func post(_ post: Post, comments: [Comment] = []) async -> PostModel {
        social.posts[post.communityId] = [post]
        social.comments[post.postId] = comments
        let model = PostModel(social: social, postId: post.postId, now: { FakeAccount.now })
        await model.load()
        return model
    }

    func testAWallPostLoadsWithoutACommunityAndTakesComments() async {
        let model = await post(wallPost("w1", owner: "a2"))
        XCTAssertNotNil(model.post)
        XCTAssertNil(model.problem)
        XCTAssertFalse(social.calls.contains { $0.hasPrefix("community ") })
        XCTAssertTrue(model.writes)
        XCTAssertFalse(model.moderates)
    }

    func testTheOwnerRemovesACommentWithAReasonAndNothingGoesWithoutOne() async {
        let model = await post(wallPost("w1"), comments: [makeComment("c1", on: "w1")])
        XCTAssertTrue(model.ownsWall)
        await model.removeWallComment("c1", reason: "   ")
        XCTAssertFalse(social.calls.contains { $0.hasPrefix("removeWallComment") })
        await model.removeWallComment("c1", reason: " Óviðeigandi ")
        XCTAssertTrue(social.calls.contains("removeWallComment c1 Óviðeigandi"))
        XCTAssertTrue(model.comments.isEmpty)
    }

    func testOnlyTheWallOwnerRemovesComments() async {
        let model = await post(wallPost("w1", owner: "a2"), comments: [makeComment("c1", on: "w1")])
        XCTAssertFalse(model.ownsWall)
        await model.removeWallComment("c1", reason: "Því")
        XCTAssertFalse(social.calls.contains { $0.hasPrefix("removeWallComment") })
    }

    func testTheOwnerChangesThePostsAudience() async {
        let model = await post(wallPost("w1"))
        await model.setAudience(.everyone)
        XCTAssertTrue(social.calls.contains("setPostAudience w1 everyone"))
        XCTAssertEqual(model.post?.audience, .everyone)
    }
}
