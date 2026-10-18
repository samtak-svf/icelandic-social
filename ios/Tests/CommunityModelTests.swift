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
}
