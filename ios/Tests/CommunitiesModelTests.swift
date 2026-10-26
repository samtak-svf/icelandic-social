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

    func testTheFeedUnderMyCommunitiesLoadsOnceHoweverOftenThePartOpens() async {
        let model = await model()
        social.mine = ["k1"]
        social.posts = ["k1": [makePost("p1", "k1")]]
        model.part = .mine
        await model.loadFeed()
        await model.loadFeed()
        XCTAssertEqual(model.feedPosts.map(\.postId), ["p1"])
        XCTAssertEqual(social.calls.filter { $0.hasPrefix("feed") }.count, 1)
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
        await model.react("p2", "❤️")
        XCTAssertNil(model.feedPosts[1].myEmoji)
        await model.react("p1", "❤️")
        XCTAssertEqual(model.feedPosts[0].myEmoji, "❤️")
        XCTAssertEqual(social.calls.last, "react p1 ❤️")
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

    func testTheFramingOfANewPictureAndCoverIsSentOnceTheCommunityExists() async throws {
        let model = await model()
        let picture = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString + ".jpg")
        let cover = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString + ".jpg")
        try Data("x".utf8).write(to: picture)
        try Data("y".utf8).write(to: cover)
        let wish = Framing(focus: Focus(x: 0.1, y: 0.2), overrides: [])
        let made = await model.create(
            name: "Bækur", description: "", audience: .open, picture: { picture }, cover: { cover },
            pictureFraming: wish, coverFraming: wish)
        XCTAssertTrue(made)
        XCTAssertEqual(social.framings.map(\.image), ["picture", "cover"])
        let order = social.calls.filter { $0.hasPrefix("createCommunity") || $0.contains("Framing") }
        XCTAssertEqual(
            order, ["createCommunity Bækur", "setCommunityPictureFraming made1", "setCommunityCoverFraming made1"])
    }

    func testAPictureAndACoverGoWithTheNewCommunityAndAFailedOneDoesNotMakeItAgain() async throws {
        let model = await model()
        let file = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString + ".jpg")
        try Data("x".utf8).write(to: file)
        let made = await model.create(
            name: "Bækur", description: "", audience: .open, picture: { file },
            cover: { throw CocoaError(.fileReadCorruptFile) })
        XCTAssertTrue(made)
        XCTAssertNotNil(model.mine.first?.photo)
        XCTAssertNil(model.mine.first?.cover, "the cover that could not be made is left out")
        XCTAssertEqual(social.calls.filter { $0.hasPrefix("createCommunity") }.count, 1)
        XCTAssertFalse(social.calls.contains { $0.hasPrefix("setCommunityCover") })
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
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

    func testPinnedCommunitiesLeadAndKeepTheServersOrderWithinEachGroup() async {
        let model = await model()
        social.communities["k2"] = makeCommunity("k2", "Fjallgöngur", role: .member)
        social.communities["k3"] = makeCommunity("k3", "Fiskar", audience: .private, role: .member, pinned: true)
        social.mine = ["k1", "k2", "k3"]
        await model.load()
        XCTAssertEqual(model.mine.map(\.communityId), ["k3", "k1", "k2"])
    }

    func testPinningAndUnpinningAreTheServersAndReorderTheList() async {
        let model = await model()
        social.communities["k2"] = makeCommunity("k2", "Fjallgöngur", role: .member)
        social.mine = ["k1", "k2"]
        await model.load()
        await model.pin("k2", true)
        XCTAssertTrue(social.calls.contains("pinCommunity k2"))
        XCTAssertEqual(model.mine.map(\.communityId), ["k2", "k1"])
        XCTAssertEqual(model.mine.first?.pinned, true)
        await model.pin("k2", false)
        XCTAssertTrue(social.calls.contains("unpinCommunity k2"))
        XCTAssertEqual(model.mine.map(\.communityId), ["k1", "k2"])
    }

    func testUnreadComesFromTheServerAndIsGoneOnceTheFeedIsOpenedAndTheHubReread() async {
        let model = await model()
        social.communities["k1"]?.unread = 3
        await model.load()
        XCTAssertEqual(model.mine.first?.unread, 3)
        social.communities["k1"]?.unread = 0
        await model.load()
        XCTAssertEqual(model.mine.first?.unread, 0)
    }

    func testAnUnknownCommunityIsNotPinned() async {
        let model = await model()
        await model.pin("zz", true)
        XCTAssertFalse(social.calls.contains("pinCommunity zz"))
    }

    func testAFeedPollIsVotedInWhereThisAccountMayWriteAndClosedByItsModerator() async {
        let model = await model()
        social.communities["k1"] = makeCommunity("k1", "Fuglar", role: .moderator)
        social.communities["k3"] = makeCommunity("k3", "Fiskar", audience: .private)
        social.mine = ["k1", "k3"]
        let poll = Poll(
            options: [
                PollOption(optionId: "o0", text: "Já", votes: nil), PollOption(optionId: "o1", text: "Nei", votes: nil),
            ], total: 0, mine: nil, closed: false)
        social.posts = [
            "k1": [makePost("p1", "k1", createdAt: 400, poll: poll)],
            "k3": [makePost("p2", "k3", createdAt: 300, poll: poll)],
        ]
        await model.load()
        await model.loadFeed()
        await model.vote("p1", option: "o1")
        XCTAssertEqual(model.feedPosts[0].poll?.mine, "o1")
        XCTAssertEqual(social.calls.last, "votePoll p1 o1")
        await model.withdrawVote("p1")
        XCTAssertNil(model.feedPosts[0].poll?.mine)
        XCTAssertTrue(model.canClose(model.feedPosts[0]))
        await model.closePoll("p1")
        XCTAssertEqual(model.feedPosts[0].poll?.closed, true)
        XCTAssertFalse(model.canClose(model.feedPosts[0]))
        await model.vote("p1", option: "o0")
        XCTAssertEqual(model.problem, .pollClosed)
        // A community this account may not write in takes no vote.
        let before = social.calls.count
        await model.vote("p2", option: "o0")
        XCTAssertEqual(social.calls.count, before)
    }
}
