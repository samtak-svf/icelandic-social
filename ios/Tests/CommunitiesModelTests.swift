import SpjallCore
import XCTest

@testable import Spjall

@MainActor
final class CommunitiesModelTests: XCTestCase {
    private let social = FakeSocial()

    private func model() async -> CommunitiesModel {
        social.communities = [
            "k1": makeCommunity("k1", "Fuglar", role: .member),
            "k2": makeCommunity("k2", "Fjallgöngur"),
            "k3": makeCommunity("k3", "Fiskar", audience: .private),
        ]
        social.mine = ["k1"]
        let model = CommunitiesModel(social: social, sleep: { _ in })
        await model.load()
        return model
    }

    func testListsTheCommunitiesThisAccountIsIn() async {
        let model = await model()
        XCTAssertTrue(model.loaded)
        XCTAssertTrue(model.verified)
        XCTAssertEqual(model.mine.map(\.communityId), ["k1"])
    }

    func testASearchFindsByNameAPageAtATime() async {
        let model = await model()
        model.query = "f"
        await model.search()
        XCTAssertTrue(model.searched)
        XCTAssertEqual(model.found.map(\.name), ["Fiskar", "Fjallgöngur"])
        XCTAssertNotNil(model.next)
        await model.more()
        XCTAssertEqual(model.found.map(\.name), ["Fiskar", "Fjallgöngur", "Fuglar"])
        XCTAssertNil(model.next)
    }

    func testAnEmptySearchListsEveryCommunityAPageAtATime() async {
        let model = await model()
        model.query = "fug"
        await model.search()
        XCTAssertEqual(model.found.map(\.name), ["Fuglar"])
        model.query = "  "
        await model.search()
        XCTAssertFalse(model.searched)
        XCTAssertEqual(model.found.map(\.name), ["Fiskar", "Fjallgöngur"])
        XCTAssertNotNil(model.next)
        XCTAssertFalse(model.searching)
        await model.more()
        XCTAssertEqual(model.found.map(\.name), ["Fiskar", "Fjallgöngur", "Fuglar"])
        XCTAssertNil(model.next)
    }

    func testTheFeedCarriesEveryCommunityNewestFirstAPageAtATime() async {
        let model = await model()
        social.mine = ["k1", "k3"]
        social.posts = [
            "k1": [makePost("p1", "k1", createdAt: 100), makePost("p2", "k1", createdAt: 400)],
            "k3": [makePost("p3", "k3", createdAt: 200), makePost("p4", "k3", createdAt: 300)],
        ]
        await model.loadFeed()
        XCTAssertTrue(model.feedLoaded)
        XCTAssertEqual(model.feedPosts.map(\.postId), ["p2", "p4"])
        XCTAssertNotNil(model.feedNext)
        await model.moreFeed()
        XCTAssertEqual(model.feedPosts.map(\.postId), ["p2", "p4", "p3", "p1"])
        XCTAssertNil(model.feedNext)
    }

    func testAFeedPostIsReactedToOnlyWhereThisAccountMayWrite() async {
        let model = await model()
        social.mine = ["k1", "k3"]
        social.posts = [
            "k1": [makePost("p1", "k1", createdAt: 400)],
            "k3": [makePost("p2", "k3", createdAt: 300)],
        ]
        await model.loadFeed()
        XCTAssertTrue(model.writes(model.feedPosts[0]))
        XCTAssertFalse(model.writes(model.feedPosts[1]))
        await model.react("p2", .love)
        XCTAssertNil(model.feedPosts[1].myReaction)
        await model.react("p1", .love)
        XCTAssertEqual(model.feedPosts[0].myReaction, .love)
        XCTAssertEqual(social.calls.last, "react p1 love")
    }

    func testAFailedFeedSaysWhyAndRetries() async {
        let model = await model()
        social.posts = ["k1": [makePost("p1", "k1")]]
        social.failNext = unreachable
        await model.loadFeed()
        XCTAssertEqual(model.problem, .unreachable)
        XCTAssertEqual(model.feedPosts, [])
        XCTAssertTrue(model.feedLoaded)
        await model.retry()
        XCTAssertNil(model.problem)
        XCTAssertEqual(model.feedPosts.map(\.postId), ["p1"])
    }

    func testAVerifiedAccountMakesACommunityAndGoesIntoIt() async {
        let model = await model()
        let made = await model.create(name: "  Bækur ", description: "Lestur", audience: .private)
        XCTAssertTrue(made)
        XCTAssertEqual(model.created, "made1")
        XCTAssertEqual(model.mine.first?.name, "Bækur")
        XCTAssertEqual(model.mine.first?.role, .owner)
        XCTAssertTrue(social.calls.contains("createCommunity Bækur"))
        model.opened()
        XCTAssertNil(model.created)
    }

    func testAnUnverifiedAccountOrABlankNameMakesNone() async {
        social.verified = false
        let model = await model()
        XCTAssertFalse(model.verified)
        let unverified = await model.create(name: "Bækur", description: "", audience: .open)
        XCTAssertFalse(unverified)
        social.verified = true
        await model.load()
        let blank = await model.create(name: "   ", description: "", audience: .open)
        XCTAssertFalse(blank)
        let long = await model.create(
            name: String(repeating: "a", count: communityNameLimit + 1), description: "", audience: .open)
        XCTAssertFalse(long)
        let wordy = await model.create(
            name: "Bækur", description: String(repeating: "a", count: communityDescriptionLimit + 1),
            audience: .open)
        XCTAssertFalse(wordy)
        XCTAssertFalse(social.calls.contains { $0.hasPrefix("createCommunity") })
    }

    func testAFailedLoadShowsTheProblemAndRetries() async {
        social.failNext = unreachable
        let model = await model()
        XCTAssertEqual(model.problem, .unreachable)
        XCTAssertTrue(model.loaded)
        await model.retry()
        XCTAssertNil(model.problem)
        XCTAssertEqual(model.mine.map(\.communityId), ["k1"])
    }
}
