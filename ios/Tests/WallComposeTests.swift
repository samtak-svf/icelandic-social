import SpjallCore
import XCTest

@testable import Spjall

/// The wall's cover, its composer with images and polls, the reactions on its list, and the notices that open a
/// wall post (decisions 0115, 0116). A suspended account is offered the controls that write in none of them.
@MainActor
final class WallComposeTests: XCTestCase {
    private let social = FakeSocial()
    private let suspended = AccountSuspension(until: nil)

    private func wall(suspended: Bool = false, posts: [Post] = []) async -> WallModel {
        social.walls.posts["a1"] = posts
        let model = WallModel(social: social, accountId: "a1")
        await model.load()
        if suspended { model.suspension = self.suspended }
        return model
    }

    private func wallPost(_ id: String, poll: Poll? = nil, mine: Bool = false) -> Post {
        var post = makePost(id, "w-a1", body: "Á veggnum", author: jon, own: mine)
        post.wallOwner = "a1"
        post.poll = poll
        return post
    }

    private func openPoll() -> Poll {
        Poll(
            options: [
                PollOption(optionId: "o0", text: "Já", votes: nil), PollOption(optionId: "o1", text: "Nei", votes: nil),
            ], total: 0, mine: nil, closed: false)
    }

    private func file(_ name: String) throws -> Picked {
        let url = FileManager.default.temporaryDirectory.appending(path: "\(UUID().uuidString)-\(name)")
        try Data("jpeg".utf8).write(to: url)
        return Picked(mime: "image/jpeg", size: 4) { url }
    }

    private nonisolated func temp() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString + ".webp")
        try Data("x".utf8).write(to: url)
        return url
    }

    // MARK: Cover

    func testAPickedCoverIsSetAndFramedAndShownAtOnce() async throws {
        let model = await wall()
        XCTAssertNil(model.wall?.cover)
        let master = try temp()
        await model.setCover({ master }, framing: Framing(focus: Focus(x: 0.1, y: 0.2), overrides: []))
        XCTAssertTrue(social.calls.contains("setWallCover"))
        XCTAssertTrue(social.calls.contains("setWallCoverFraming"))
        XCTAssertEqual(model.wall?.cover, "v2")
        XCTAssertFalse(FileManager.default.fileExists(atPath: master.path))
    }

    func testTheCoverIsFramedAgainFromItsMasterAndTakenAway() async throws {
        social.walls.covers["a1"] = "v1"
        let model = await wall()
        let found = await model.coverMaster()
        let master = try XCTUnwrap(found)
        XCTAssertTrue(FileManager.default.fileExists(atPath: master.path))
        try? FileManager.default.removeItem(at: master)
        await model.reframeCover(Framing(focus: Focus(x: 0.1, y: 0.2), overrides: []))
        XCTAssertEqual(model.wall?.cover, "v2")
        await model.removeCover()
        XCTAssertNil(model.wall?.cover)
        XCTAssertTrue(social.calls.contains("removeWallCover"))
    }

    func testACoverWithNoMasterSaysSoInsteadOfOpeningTheSheet() async {
        social.walls.covers["a1"] = "v1"
        social.walls.hasMaster = false
        let model = await wall()
        let master = await model.coverMaster()
        XCTAssertNil(master)
        XCTAssertNotNil(model.problem)
    }

    func testASuspendedAccountMayOnlyTakeItsCoverAway() async throws {
        social.walls.covers["a1"] = "v1"
        let model = await wall(suspended: true)
        XCTAssertEqual(model.coverControls, WallModel.CoverControls(pick: false, reframe: false, remove: true))
        let spare = try temp()
        await model.setCover({ spare })
        let master = await model.coverMaster()
        await model.reframeCover(Framing(focus: Focus(x: 0.1, y: 0.2), overrides: []))
        XCTAssertNil(master)
        XCTAssertFalse(social.calls.contains { $0.hasPrefix("setWallCover") || $0.hasPrefix("wallCoverSource") })
        XCTAssertEqual(model.wall?.cover, "v1")
        await model.removeCover()
        XCTAssertNil(model.wall?.cover)
    }

    func testTheCoverControlsFollowWhetherThereIsACover() async {
        let bare = await wall()
        XCTAssertEqual(bare.coverControls, WallModel.CoverControls(pick: true, reframe: false, remove: false))
        let bareSuspended = await wall(suspended: true)
        XCTAssertEqual(
            bareSuspended.coverControls, WallModel.CoverControls(pick: false, reframe: false, remove: false))
        social.walls.covers["a1"] = "v1"
        let covered = await wall()
        XCTAssertEqual(covered.coverControls, WallModel.CoverControls(pick: true, reframe: true, remove: true))
    }

    // MARK: Composer

    func testImagesAreUploadedAndGoWithTheWallPost() async throws {
        let model = await wall()
        await model.attachments.pick(try file("ein.jpg"))
        await model.attachments.pick(try file("tvo.jpg"))
        XCTAssertTrue(model.publishable)
        let ids = model.attachments.images.map { "m-" + URL(filePath: $0).lastPathComponent }
        let posted = await model.publish()
        XCTAssertTrue(posted)
        XCTAssertEqual(social.calls.filter { $0.hasPrefix("uploadWallImage") }.count, 2)
        XCTAssertTrue(social.calls.contains("createWallPost  friends media=\(ids.joined(separator: ",")) poll=[]"))
        XCTAssertTrue(model.attachments.images.isEmpty)
    }

    func testAPollIsPostedWithItsOptionsAndTakesNoImages() async throws {
        let model = await wall()
        model.attachments.setPoll(true)
        model.draft = "Hvað er best?"
        XCTAssertFalse(model.publishable)
        model.attachments.pollFields = [" Lóa ", "Spói"]
        XCTAssertTrue(model.publishable)
        XCTAssertFalse(model.attachments.roomForImage())
        let posted = await model.publish()
        XCTAssertTrue(posted)
        XCTAssertTrue(social.calls.contains("createWallPost Hvað er best? friends media= poll=[\"Lóa\", \"Spói\"]"))
        XCTAssertNil(model.attachments.pollFields)
    }

    func testAnImageTheServerRefusesIsNamedAndTheDraftStays() async throws {
        let model = await wall()
        model.draft = "Mynd"
        await model.attachments.pick(try file("stor.jpg"))
        social.refuseImage = CoreError.Refused(status: 413, code: "too_large", requestId: nil)
        let posted = await model.publish()
        XCTAssertFalse(posted)
        XCTAssertEqual(model.attachments.imageNotice, .tooLarge)
        XCTAssertEqual(model.draft, "Mynd")
        XCTAssertFalse(social.calls.contains { $0.hasPrefix("createWallPost") })
    }

    func testAPostOverTheLimitOrWhileSuspendedIsNotPublished() async {
        let model = await wall()
        model.draft = String(repeating: "a", count: CommunityModel.postLimit + 1)
        XCTAssertFalse(model.publishable)
        model.draft = "Í lagi"
        XCTAssertTrue(model.publishable)
        model.suspension = suspended
        XCTAssertFalse(model.publishable)
        let posted = await model.publish()
        XCTAssertFalse(posted)
        XCTAssertFalse(social.calls.contains { $0.hasPrefix("createWallPost") })
    }

    // MARK: Reactions and votes on the list

    func testAReactionOnAListedWallPostTogglesAndRollsBackWhenRefused() async {
        let model = await wall(posts: [wallPost("w1")])
        await model.react("w1", "❤️")
        XCTAssertEqual(model.posts[0].myEmoji, "❤️")
        await model.react("w1", "❤️")
        XCTAssertNil(model.posts[0].myEmoji)
        XCTAssertEqual(social.calls.suffix(2), ["react w1 ❤️", "unreact w1"])
        social.failOn = "react"
        await model.react("w1", "👍")
        XCTAssertNil(model.posts[0].myEmoji)
        XCTAssertNotNil(model.problem)
    }

    func testASuspendedAccountReactsAndVotesNowhereOnTheList() async {
        let poll = openPoll()
        let model = await wall(suspended: true, posts: [wallPost("w1", poll: poll)])
        await model.react("w1", "❤️")
        await model.vote("w1", option: "o0")
        XCTAssertNil(model.posts[0].myEmoji)
        XCTAssertNil(model.posts[0].poll?.mine)
        XCTAssertFalse(social.calls.contains { $0.hasPrefix("react") || $0.hasPrefix("votePoll") })
    }

    func testAVoteOnAListedWallPollShowsAndWithdraws() async {
        let poll = openPoll()
        let model = await wall(posts: [wallPost("w1", poll: poll, mine: true)])
        XCTAssertTrue(model.canClose(model.posts[0]))
        await model.vote("w1", option: "o1")
        XCTAssertEqual(model.posts[0].poll?.mine, "o1")
        await model.withdrawVote("w1")
        XCTAssertNil(model.posts[0].poll?.mine)
        await model.closePoll("w1")
        XCTAssertEqual(model.posts[0].poll?.closed, true)
        XCTAssertFalse(model.canClose(model.posts[0]))
    }

    // MARK: Notices

    func testAWallNoticeOpensItsPostEvenThoughItsCommunityIsTheWall() {
        for kind in [SocialNotificationKind.comment, .reaction] {
            XCTAssertEqual(noticeRoute(makeNotice("n", kind, community: "w-a1", post: "w1")), .post("w1"))
        }
        // With the post gone it falls back to the wall's id, as the web's notice row does (notice-row.tsx:90-95).
        XCTAssertEqual(noticeRoute(makeNotice("n", .comment, community: "w-a1")), .community("w-a1"))
    }
}
