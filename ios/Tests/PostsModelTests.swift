import SpjallCore
import XCTest

@testable import Spjall

@MainActor
final class PostsModelTests: XCTestCase {
    private let account = FakeAccount(signedIn: true)

    private func model(_ source: PostsModel.Source = .feed) async -> PostsModel {
        let model = PostsModel(account: account, source: source)
        await model.refresh()
        return model
    }

    func testPagesThroughFljotidAndStopsAtTheLastPage() async {
        account.posts = (1...45).map { samplePost("p\($0)") }
        let model = await model()
        XCTAssertTrue(model.loaded)
        XCTAssertEqual(model.posts.count, 30)
        XCTAssertEqual(model.me, "a1")

        await model.loadMore()
        XCTAssertEqual(model.posts.map(\.postId), (1...45).map { "p\($0)" })
        await model.loadMore()
        XCTAssertEqual(account.calls.filter { $0.hasPrefix("feed") }, ["feed -", "feed 30"])
    }

    func testARefreshReplacesWhatWasShown() async {
        account.posts = [samplePost("p1")]
        let model = await model()
        account.posts = [samplePost("p2"), samplePost("p1")]
        await model.refresh()
        XCTAssertEqual(model.posts.map(\.postId), ["p2", "p1"])
    }

    func testAPostLeadsTheListAndABlankOneIsNotSent() async {
        account.posts = [samplePost("p1")]
        let model = await model()
        let blank = await model.post(body: "  \n ")
        XCTAssertFalse(blank)
        XCTAssertFalse(account.calls.contains { $0.hasPrefix("createPost") })

        let posted = await model.post(body: " Halló \n")
        XCTAssertTrue(posted)
        XCTAssertEqual(model.posts.map(\.body), ["Halló", "body of p1"])
        XCTAssertEqual(account.calls.last, "createPost Halló")
    }

    func testAPostOverTheLimitIsNotSent() async {
        let model = await model()
        let posted = await model.post(body: String(repeating: "a", count: PostsModel.maxLength + 1))
        XCTAssertFalse(posted)
        XCTAssertFalse(account.calls.contains { $0.hasPrefix("createPost") })
    }

    func testAHeartShowsAtOnceAndComesOffAgain() async {
        account.posts = [samplePost("p1", hearts: 2)]
        let model = await model()
        await model.toggleHeart(model.posts[0])
        XCTAssertEqual(model.posts[0].myReaction, .heart)
        XCTAssertEqual(model.posts[0].reactions.heart, 3)
        XCTAssertEqual(account.calls.last, "reactToPost p1 heart")

        await model.toggleHeart(model.posts[0])
        XCTAssertNil(model.posts[0].myReaction)
        XCTAssertEqual(model.posts[0].reactions.heart, 2)
        XCTAssertEqual(account.calls.last, "reactToPost p1 nil")
    }

    func testAnotherReactionIsTakenBackByTheHeartButton() async {
        account.posts = [samplePost("p1", mine: .laugh)]
        let model = await model()
        await model.toggleHeart(model.posts[0])
        XCTAssertNil(model.posts[0].myReaction)
        XCTAssertEqual(model.posts[0].reactionTotal, 0)
    }

    func testAHeartTheServerRefusesIsPutBack() async {
        account.posts = [samplePost("p1", hearts: 1)]
        let model = await model()
        account.failNext = CoreError.Refused(status: 403, code: "blocked")
        await model.toggleHeart(model.posts[0])
        XCTAssertNil(model.posts[0].myReaction)
        XCTAssertEqual(model.posts[0].reactions.heart, 1)
        XCTAssertEqual(model.problem, .generic)
    }

    func testDeletingAPostTakesItOffTheList() async {
        account.posts = [samplePost("p2", author: person("a1", "Jón Jónsson")), samplePost("p1")]
        let model = await model()
        await model.delete("p2")
        XCTAssertEqual(model.posts.map(\.postId), ["p1"])
        XCTAssertEqual(account.calls.last, "deletePost p2")
    }

    func testAnotherAccountsWallShowsWhoItIsAndOnlyTheirPosts() async {
        account.profiles = ["a2": person("a2", "Anna")]
        account.posts = [samplePost("p3", author: person("a3")), samplePost("p2"), samplePost("p1")]
        let model = await model(.wall("a2"))
        XCTAssertEqual(model.person?.name, "Anna")
        XCTAssertEqual(model.posts.map(\.postId), ["p2", "p1"])
        XCTAssertTrue(model.other)
        XCTAssertFalse(model.blocked)
    }

    func testTheOwnWallAsksForNoProfile() async {
        account.posts = [samplePost("p1", author: person("a1", "Jón Jónsson"))]
        let model = await model(.wall("a1"))
        XCTAssertFalse(model.other)
        XCTAssertNil(model.person)
        XCTAssertFalse(account.calls.contains { $0.hasPrefix("profile") })
        XCTAssertEqual(model.posts.map(\.postId), ["p1"])
    }

    func testTheBlockedCannotBeWrittenTo() async {
        account.blockedPeople = [person("a2", "Anna")]
        let model = await model(.wall("a2"))
        XCTAssertTrue(model.blocked)
        let opened = await model.contact()
        XCTAssertNil(opened)
        XCTAssertFalse(account.calls.contains { $0.hasPrefix("openDirect") })
    }

    func testWritingFromAWallOpensTheOneToOneWithoutALink() async {
        account.list = [conversation("one", members: [person("a2")])]
        let model = await model(.wall("a2"))
        let opened = await model.contact()
        XCTAssertEqual(opened, "one")
        XCTAssertEqual(account.calls.last, "openDirect a2")
    }

    func testAFailedFirstLoadCanBeTriedAgain() async {
        account.posts = [samplePost("p1")]
        account.failNext = unreachable
        let model = await model()
        XCTAssertEqual(model.problem, .unreachable)
        XCTAssertTrue(model.posts.isEmpty)

        await model.retry()
        XCTAssertNil(model.problem)
        XCTAssertEqual(model.posts.map(\.postId), ["p1"])
    }
}
