import SpjallCore
import SwiftUI
import XCTest

@testable import Spjall

/// Fljótið (decision 0116): the feed that only `End` ends, the composer that starts on the wall and can post in a
/// community, the card heading, the tabs and the width the tab bar has for their names.
@MainActor
final class HomeTests: XCTestCase {
    private let social = FakeSocial()

    private func wallPost(_ id: String) -> Post {
        var post = makePost(id, "w-a1", body: "Á veggnum", author: jon)
        post.wallOwner = "a1"
        post.audience = .friends
        return post
    }

    private func file(_ name: String) throws -> Picked {
        let url = FileManager.default.temporaryDirectory.appending(path: "\(UUID().uuidString)-\(name)")
        try Data("jpeg".utf8).write(to: url)
        return Picked(mime: "image/jpeg", size: 4) { url }
    }

    private func home(pages: [HomePage] = []) async -> HomeModel {
        social.mine = ["c1", "c2"]
        social.communities = [
            "c1": makeCommunity("c1", "Eitt", role: .member), "c2": makeCommunity("c2", "Tvö", role: .moderator),
        ]
        social.feed.pages = pages
        social.feed.offered = [makeCommunity("c1", "Eitt", anonymousPosts: true), makeCommunity("c2", "Tvö")]
        let model = HomeModel(social: social)
        await model.load()
        return model
    }

    // MARK: Reading

    func testAnEmptyMoreKeepsFetchingAndOnlyEndEndsTheList() async {
        let model = await home(pages: [
            .more(posts: [], next: "1"), .more(posts: [], next: "2"), .more(posts: [makePost("p1", "c1")], next: "3"),
            .end(posts: [makePost("p2", "c1")]),
        ])
        XCTAssertEqual(model.posts.map(\.postId), ["p1"], "two empty pages did not end the list")
        XCTAssertEqual(model.next, "3")
        await model.more()
        XCTAssertEqual(model.posts.map(\.postId), ["p1", "p2"])
        XCTAssertNil(model.next, "End ends it")
    }

    func testPagesThatStayEmptyHandBackTheCursorRatherThanLoopForever() async {
        let model = await home(pages: (1...20).map { .more(posts: [], next: String($0)) })
        XCTAssertTrue(model.posts.isEmpty)
        XCTAssertEqual(model.next, String(HomeModel.emptyPagesInARow), "the sentinel asks again from here")
        XCTAssertEqual(social.feed.asked, HomeModel.emptyPagesInARow)
    }

    func testAFailedFirstPageIsRetriedAndTheCommunitiesStillLoad() async {
        social.failOn = "home"
        let model = await home(pages: [.end(posts: [makePost("p1", "c1")])])
        XCTAssertNotNil(model.problem)
        XCTAssertEqual(model.targets.map(\.communityId), ["c1", "c2"])
        social.failOn = nil
        await model.retry()
        XCTAssertEqual(model.posts.map(\.postId), ["p1"])
        XCTAssertNil(model.problem)
    }

    func testAnEmptyListWithMoreBehindItIsSearchingNotEmpty() async {
        let model = await home(pages: (1...20).map { .more(posts: [], next: String($0)) })
        XCTAssertTrue(model.posts.isEmpty)
        XCTAssertFalse(model.isEmptyForGood, "a cursor is left: not an empty feed")
        XCTAssertTrue(model.isSearching)
        let ended = await home(pages: [.end(posts: [])])
        XCTAssertTrue(ended.isEmptyForGood)
        XCTAssertFalse(ended.isSearching)
    }

    func testTheSentinelAsksOnlyWhenNothingIsOnItsWayAndTheLastTryDidNotFail() async {
        let model = await home(pages: [.more(posts: [makePost("p1", "c1")], next: "1"), .end(posts: [])])
        XCTAssertTrue(model.wantsMore)
        social.failOn = "home"
        await model.more()
        XCTAssertFalse(model.wantsMore, "a failed page waits for Retry, it does not loop")
        let done = await home(pages: [.end(posts: [makePost("p1", "c1")])])
        XCTAssertFalse(done.wantsMore, "no cursor, nothing to ask")
    }

    func testRefreshReplacesTheListAndAFailedOneKeepsIt() async {
        let model = await home(pages: [.end(posts: [makePost("p1", "c1")]), .end(posts: [makePost("p2", "c1")])])
        await model.refresh()
        XCTAssertEqual(model.posts.map(\.postId), ["p2"], "replaced, not appended")
        social.failOn = "home"
        await model.refresh()
        XCTAssertEqual(model.posts.map(\.postId), ["p2"], "a failure does not wipe the list")
        XCTAssertNotNil(model.problem)
        social.failOn = nil
        social.feed.asked = 0
        social.feed.pages = [.end(posts: [makePost("p3", "c1")])]
        await model.refresh()
        XCTAssertEqual(model.posts.map(\.postId), ["p3"])
        XCTAssertNil(model.problem)
    }

    // MARK: Headings

    func testAWallPostShowsItsAuthorAloneAndACommunityPostItsCommunity() async {
        let model = await home()
        XCTAssertNil(model.heading(wallPost("w1")))
        XCTAssertEqual(model.heading(makePost("p1", "c2"))?.name, "Tvö")
        XCTAssertNil(model.heading(makePost("p2", "gone")), "a community without a list entry shows its author")
    }

    func testReactingAndClosingFollowWhereThePostIs() async {
        let model = await home()
        let options = [PollOption(optionId: "o0", text: "Já", votes: nil)]
        let poll = Poll(options: options, total: 0, mine: nil, closed: false)
        XCTAssertTrue(model.writes(wallPost("w1")))
        XCTAssertTrue(model.writes(makePost("p1", "c1")))
        XCTAssertFalse(model.writes(makePost("p2", "gone")))
        XCTAssertTrue(model.canClose(makePost("p3", "c1", author: jon, poll: poll)), "its author may")
        XCTAssertTrue(model.canClose(makePost("p4", "c2", poll: poll)), "a moderator of its community may")
        XCTAssertFalse(model.canClose(makePost("p5", "c1", poll: poll)), "a member may not close another's")
        var onWall = wallPost("w2")
        onWall.author = anna
        onWall.mine = false
        onWall.poll = poll
        XCTAssertFalse(model.canClose(onWall), "a moderator's role is the community's, not a wall's")
        model.suspension = AccountSuspension(until: nil)
        XCTAssertFalse(model.writes(wallPost("w1")))
        XCTAssertFalse(model.writes(makePost("p1", "c1")))
    }

    func testAFailedReactionIsRolledBack() async {
        let model = await home(pages: [.end(posts: [makePost("p1", "c1")])])
        social.failOn = "react"
        await model.react("p1", "👍")
        XCTAssertNil(model.posts.first?.myEmoji)
        XCTAssertNotNil(model.problem)
    }

    // MARK: Composing

    func testTheComposerStartsWhereTheCoreSaysAndAnonymousNeedsACommunityThatAllowsIt() async {
        let model = await home()
        XCTAssertEqual(model.place, .wall)
        XCTAssertEqual(model.audience, .friends)
        XCTAssertEqual(model.target, .wall(audience: .friends))
        model.anonymous = true
        model.place = .community("c2")
        XCTAssertEqual(model.target, .community(communityId: "c2", anonymous: false), "c2 does not allow it")
        model.place = .community("c1")
        XCTAssertEqual(model.target, .community(communityId: "c1", anonymous: true))
    }

    func testAPostGoesToTheWallWithItsAudienceAndComesOutFirst() async {
        let model = await home(pages: [.end(posts: [makePost("p1", "c1")])])
        model.audience = .everyone
        model.draft = "  Nýtt  "
        let posted = await model.publish()
        XCTAssertTrue(posted)
        XCTAssertTrue(
            social.calls.contains { $0.hasPrefix("postTo") && $0.contains("everyone") && $0.contains("Nýtt") })
        XCTAssertEqual(model.posts.map(\.postId), ["h-made1", "p1"])
        XCTAssertEqual(model.draft, "")
    }

    func testAPostInAPickedCommunityCarriesTheTarget() async {
        let model = await home()
        model.place = .community("c1")
        model.anonymous = true
        model.draft = "Hér"
        let posted = await model.publish()
        XCTAssertTrue(posted)
        XCTAssertEqual(model.posts.first?.communityId, "c1")
        XCTAssertTrue(social.calls.contains { $0.hasPrefix("postTo") && $0.contains("anonymous: true") })
    }

    func testACommunityThatIsNotOfferedCannotBePostedIn() async {
        let model = await home()
        model.place = .community("gone")
        model.draft = "Hér"
        XCTAssertFalse(model.publishable)
        let posted = await model.publish()
        XCTAssertFalse(posted)
        XCTAssertFalse(social.calls.contains { $0.hasPrefix("postTo") })
    }

    func testASuspensionOrAnEmptyDraftBlocksPublishing() async {
        let model = await home()
        XCTAssertFalse(model.publishable)
        model.draft = "Orð"
        XCTAssertTrue(model.publishable)
        model.suspension = AccountSuspension(until: nil)
        XCTAssertFalse(model.publishable)
    }

    func testAnotherPlaceSendsTheImagesAgain() async throws {
        let model = await home()
        await model.attachments.pick(try file("ein.jpg"))
        model.draft = "Mynd"
        social.failOn = "postTo"
        let first = await model.publish()
        XCTAssertFalse(first)
        social.failOn = nil
        model.place = .community("c1")
        let second = await model.publish()
        XCTAssertTrue(second)
        XCTAssertEqual(social.calls.filter { $0.hasPrefix("uploadPostImage") }.count, 2, "once per target")
    }

    func testTheSameTargetKeepsItsUploads() async throws {
        let model = await home()
        await model.attachments.pick(try file("ein.jpg"))
        model.draft = "Mynd"
        social.failOn = "postTo"
        _ = await model.publish()
        social.failOn = nil
        _ = await model.publish()
        XCTAssertEqual(social.calls.filter { $0.hasPrefix("uploadPostImage") }.count, 1)
    }

    // MARK: Tabs

    func testEveryStringTheFeedShowsIsInTheCatalogue() {
        let keys = ["tab_feed", "feed_empty", "feed_compose_target", "feed_target_wall"]
        for key in keys + ["wall_audience_label", "wall_audience_friends", "wall_audience_everyone"] {
            XCTAssertNotEqual(localized(key), key, "\(key) has no iOS string")
        }
    }

    func testTheFeedIsTheFirstTabAndTheAppOpensOnIt() {
        let items = HomeView.tabItems
        XCTAssertEqual(items.map(\.tab), [.feed, .conversations, .communities, .me])
        let keys = ["tab_feed", "tab_conversations", "tab_communities", "tab_me"]
        XCTAssertEqual(items.map(\.label), keys.map { localized($0) })
        XCTAssertEqual(items.first?.label, "Fljótið")
        XCTAssertEqual(HomeView.launchTab, .feed)
    }

    func testTheFourNamesFitTheBarAt320And360Points() {
        let labels = HomeView.tabItems.map(\.label)
        for width: CGFloat in [320, 360] {
            for label in labels {
                XCTAssertTrue(
                    TabBar<HomeView.Tab>.fits(label, barWidth: width, count: labels.count),
                    "\(label) at \(width)")
            }
        }
    }

    func testAtTwiceTheTextSizeTheNamesFitOnlyByShrinking() {
        let labels = HomeView.tabItems.map(\.label)
        for width: CGFloat in [320, 360] {
            for label in labels {
                XCTAssertTrue(
                    TabBar<HomeView.Tab>.fits(label, barWidth: width, count: labels.count, scale: 2, shrinking: true),
                    "\(label) at \(width), double size")
            }
        }
        XCTAssertFalse(
            TabBar<HomeView.Tab>.fits("Fljótið Fljótið Fljótið", barWidth: 320, count: 4, scale: 2, shrinking: true),
            "the check can fail")
    }

    func testAShareIsAnEqualPartOfTheBar() {
        XCTAssertEqual(TabBar<HomeView.Tab>.share(of: 320, count: 4), 80)
        XCTAssertEqual(TabBar<HomeView.Tab>.share(of: 300, count: 0), 300)
    }
}
