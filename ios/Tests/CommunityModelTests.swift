import SpjallCore
import XCTest

@testable import Spjall

@MainActor
final class CommunityModelTests: XCTestCase {
    private let social = FakeSocial()

    private func model(_ community: Community, posts: [Post]? = nil) async -> CommunityModel {
        social.communities = [community.communityId: community]
        social.posts = [
            community.communityId: posts ?? [
                makePost("p3", community.communityId), makePost("p2", community.communityId),
                makePost("p1", community.communityId),
            ]
        ]
        let model = CommunityModel(
            social: social, communityId: community.communityId, now: { FakeAccount.now }, sleep: { _ in })
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

    func testASearchAsksTheServerForTheWordsAndListsWhatItFound() async {
        let model = await model(
            makeCommunity("k1", "Fuglar", role: .member),
            posts: [makePost("p2", "k1", body: "Fyrsta lóan"), makePost("p1", "k1", body: "Annað")])
        model.query = " Lóa "
        await model.search()
        XCTAssertTrue(model.searched)
        XCTAssertEqual(model.posts.map(\.postId), ["p2"])
        XCTAssertTrue(social.calls.contains("communityPosts k1 - q:Lóa"))
    }

    func testASearchPagesTheSameWayThePlainListDoes() async {
        let model = await model(
            makeCommunity("k1", "Fuglar", role: .member),
            posts: [
                makePost("p5", "k1", body: "Lóa eitt"), makePost("p4", "k1", body: "Lóa tvö"),
                makePost("p3", "k1", body: "Lóa þrjú"), makePost("p1", "k1", body: "Annað"),
            ])
        model.query = "Lóa"
        await model.search()
        XCTAssertEqual(model.posts.map(\.postId), ["p5", "p4"])
        XCTAssertNotNil(model.next)
        await model.more()
        XCTAssertEqual(model.posts.map(\.postId), ["p5", "p4", "p3"])
        XCTAssertNil(model.next)
        XCTAssertTrue(social.calls.contains("communityPosts k1 2 q:Lóa"))
    }

    func testASearchThatFindsNothingSaysSoRatherThanShowingTheList() async {
        let model = await model(makeCommunity("k1", "Fuglar", role: .member))
        model.query = "engin"
        await model.search()
        XCTAssertTrue(model.searched)
        XCTAssertEqual(model.posts, [])
        XCTAssertNil(model.next)
    }

    func testClearingTheSearchBringsThePlainListBack() async {
        let model = await model(
            makeCommunity("k1", "Fuglar", role: .member),
            posts: [makePost("p2", "k1", body: "Fyrsta lóan"), makePost("p1", "k1", body: "Annað")])
        model.query = "Lóa"
        await model.search()
        XCTAssertEqual(model.posts.map(\.postId), ["p2"])
        model.query = ""
        await model.search()
        XCTAssertFalse(model.searched)
        XCTAssertEqual(model.posts.map(\.postId), ["p2", "p1"])
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
        XCTAssertEqual(model.noPostNotice, "community_muted")
        XCTAssertFalse(model.writes)
        XCTAssertEqual(model.posts.count, 2)
    }

    func testAPublishedPostGoesOnTopAndTheDraftEmpties() async {
        let model = await model(makeCommunity("k1", "Fuglar", role: .member))
        model.draft = "  Fyrsti lóan  "
        XCTAssertTrue(model.sendable)
        let posted = await model.publish()
        XCTAssertTrue(posted)
        XCTAssertEqual(model.posts.first?.body, "Fyrsti lóan")
        XCTAssertEqual(model.draft, "")
        XCTAssertTrue(social.calls.contains("createPost k1 Fyrsti lóan"))
    }

    func testAFailedPostKeepsTheDraft() async {
        let model = await model(makeCommunity("k1", "Fuglar", role: .member))
        model.draft = "Halló"
        social.failNext = unreachable
        let posted = await model.publish()
        XCTAssertFalse(posted)
        XCTAssertEqual(model.draft, "Halló")
        XCTAssertEqual(model.problem, .unreachable)
    }

    func testAReactionTogglesAndTheSecondTapTakesItOff() async {
        let model = await model(makeCommunity("k1", "Fuglar", role: .member))
        await model.react("p2", "❤️")
        XCTAssertEqual(model.posts[1].myEmoji, "❤️")
        XCTAssertEqual(reactionCount(model.posts[1], "❤️"), 1)
        await model.react("p2", "❤️")
        XCTAssertNil(model.posts[1].myEmoji)
        XCTAssertEqual(social.calls.suffix(2), ["react p2 ❤️", "unreact p2"])
    }

    func testARefusedReactionPutsThePostBack() async {
        let model = await model(makeCommunity("k1", "Fuglar", role: .member))
        let before = model.posts[0]
        social.failNext = unreachable
        await model.react("p3", "👍")
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

    func testTheWorkWaitingIsCountedForAModeratorOnly() async {
        let moderator = await model(
            makeCommunity(
                "k1", "Fiskar", audience: .private, role: .moderator, pendingJoinRequests: 2, openReports: 1))
        XCTAssertEqual(moderator.manageCount, 3)
        let member = await model(
            makeCommunity("k2", "Fuglar", role: .member, pendingJoinRequests: 2, openReports: 1))
        XCTAssertEqual(member.manageCount, 0)
    }

    func testTheMemberListIsAskedForOnce() async {
        social.members = ["k1": [makeMember("a1", "Jón", role: .owner), makeMember("a2", "Anna")]]
        let model = await model(makeCommunity("k1", "Fuglar", role: .member))
        await model.loadMembers()
        XCTAssertTrue(model.membersLoaded)
        XCTAssertEqual(model.members.map(\.accountId), ["a1", "a2"])
        await model.loadMembers()
        XCTAssertEqual(social.calls.filter { $0.hasPrefix("communityMembers") }.count, 1)
    }

    func testTheOwnerMakesAMemberAModeratorAndTakesItBack() async {
        social.members = ["k1": [makeMember("a1", "Jón", role: .owner), makeMember("a2", "Anna")]]
        let model = await model(makeCommunity("k1", "Fuglar", role: .owner))
        await model.loadMembers()
        await model.setRole("a2", .moderator)
        XCTAssertEqual(model.members[1].role, .moderator)
        XCTAssertTrue(social.calls.contains("setCommunityRole k1 a2 moderator"))
        await model.setRole("a2", .member)
        XCTAssertEqual(model.members[1].role, .member)
        XCTAssertEqual(model.members[0].role, .owner)
    }

    func testAMemberGivesNoRoleToAnyone() async {
        social.members = ["k1": [makeMember("a1", "Jón", role: .owner), makeMember("a2", "Anna")]]
        let model = await model(makeCommunity("k1", "Fuglar", role: .member))
        await model.loadMembers()
        await model.setRole("a2", .moderator)
        XCTAssertEqual(model.members[1].role, .member)
        XCTAssertFalse(social.calls.contains { $0.hasPrefix("setCommunityRole") })
    }

    func testTheModerationLogIsPagedNewestFirst() async {
        social.log = [
            "k1": [
                makeLogEntry(3, .hidePost), makeLogEntry(2, .muteMember), makeLogEntry(1, .closeReport),
            ]
        ]
        let model = await model(makeCommunity("k1", "Fuglar", role: .moderator))
        await model.loadLog()
        XCTAssertTrue(model.logLoaded)
        XCTAssertEqual(model.log.map(\.entryId), [3, 2])
        XCTAssertNotNil(model.logNext)
        await model.moreLog()
        XCTAssertEqual(model.log.map(\.entryId), [3, 2, 1])
        XCTAssertNil(model.logNext)
    }

    func testTheOwnerRenamesAndMakesItPrivate() async {
        let model = await model(makeCommunity("k1", "Fuglar", role: .owner))
        let saved = await model.update(name: "  Fuglar og fiskar ", description: "Ný", audience: .private)
        XCTAssertTrue(saved)
        XCTAssertEqual(model.community?.name, "Fuglar og fiskar")
        XCTAssertEqual(model.community?.audience, .private)
        XCTAssertTrue(social.calls.contains("updateCommunity k1 Fuglar og fiskar Ný private"))
        await model.update(name: "Fuglar", description: "Ný", audience: .private)
        XCTAssertEqual(social.calls.last, "updateCommunity k1 Fuglar Ný")
    }

    func testTheOwnerSetsAndRemovesThePictureAndTheCover() async throws {
        let model = await model(makeCommunity("k1", "Fuglar", role: .owner))
        let file = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString + ".jpg")
        try Data("x".utf8).write(to: file)
        await model.setPicture { file }
        XCTAssertNotNil(model.community?.photo)
        XCTAssertTrue(social.calls.contains("setCommunityAvatar k1 \(file.path)"))
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path), "the file is deleted once sent")
        let band = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString + ".jpg")
        try Data("y".utf8).write(to: band)
        await model.setCover { band }
        XCTAssertNotNil(model.community?.cover)
        XCTAssertTrue(social.calls.contains("setCommunityCover k1 \(band.path)"))
        await model.removePicture()
        XCTAssertNil(model.community?.photo)
        XCTAssertNotNil(model.community?.cover, "the cover stays")
        await model.removeCover()
        XCTAssertNil(model.community?.cover)
    }

    func testSavingTheFramingOfANewCoverSendsItAfterTheUpload() async throws {
        let model = await model(makeCommunity("k1", "Fuglar", role: .owner))
        let file = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString + ".jpg")
        try Data("x".utf8).write(to: file)
        let framing = Framing(focus: Focus(x: 0.2, y: 0.7), overrides: [])
        await model.setCover({ file }, framing: framing)
        let calls = social.calls.filter { $0.hasPrefix("setCommunityCover") }
        XCTAssertEqual(calls, ["setCommunityCover k1 \(file.path)", "setCommunityCoverFraming k1"])
        XCTAssertEqual(social.framings.map(\.image), ["cover"])
        XCTAssertEqual(social.framings.first?.framing, framing)
    }

    func testReframingSendsOnlyTheFramingAndTheOwnerAlone() async {
        let owner = await model(makeCommunity("k1", "Fuglar", role: .owner))
        let framing = Framing(focus: Focus(x: 0.5, y: 0.5), overrides: [])
        await owner.reframe(cover: false, framing)
        XCTAssertEqual(social.calls.filter { $0.contains("Framing") }, ["setCommunityPictureFraming k1"])
        XCTAssertFalse(social.calls.contains { $0.hasPrefix("setCommunityAvatar") }, "no new upload")
        let member = await model(makeCommunity("k2", "Fiskar", role: .member))
        let before = social.calls.count
        await member.reframe(cover: true, framing)
        XCTAssertEqual(social.calls.count, before)
    }

    func testACoverSetBeforeMastersWereKeptHasNoMasterToFrame() async {
        let model = await model(makeCommunity("k1", "Fuglar", role: .owner))
        social.hasMaster = false
        let file = await model.master(cover: true)
        XCTAssertNil(file)
        XCTAssertEqual(model.problem, .noMaster)
        await model.reframe(cover: true, Framing(focus: Focus(x: 0.5, y: 0.5), overrides: []))
        XCTAssertEqual(model.problem, .noMaster)
    }

    func testTheMasterIsHandedOverInAFileTheCallerDeletes() async throws {
        let model = await model(makeCommunity("k1", "Fuglar", role: .owner))
        let made = await model.master(cover: true)
        let file = try XCTUnwrap(made)
        defer { try? FileManager.default.removeItem(at: file) }
        XCTAssertEqual(try Data(contentsOf: file), Data("master".utf8))
        XCTAssertTrue(social.calls.contains("communityCoverSource k1"))
    }

    func testAMemberSetsNeitherPictureNorCover() async {
        let model = await model(makeCommunity("k1", "Fuglar", role: .member))
        let before = social.calls.count
        await model.setPicture { URL(fileURLWithPath: "/nowhere") }
        await model.setCover { URL(fileURLWithPath: "/nowhere") }
        await model.removePicture()
        await model.removeCover()
        XCTAssertEqual(social.calls.count, before)
    }

    func testAMemberOrABlankNameOrALongOneChangesNothing() async {
        let member = await model(makeCommunity("k1", "Fuglar", role: .member))
        let before = social.calls.count
        let refused = await member.update(name: "Annað", description: "", audience: .open)
        XCTAssertFalse(refused)
        XCTAssertEqual(social.calls.count, before)
        let owner = await model(makeCommunity("k2", "Fuglar", role: .owner))
        let blank = await owner.update(name: "   ", description: "", audience: .open)
        XCTAssertFalse(blank)
        let long = await owner.update(
            name: String(repeating: "a", count: communityNameLimit + 1), description: "", audience: .open)
        XCTAssertFalse(long)
        XCTAssertFalse(social.calls.contains { $0.hasPrefix("updateCommunity") })
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
        XCTAssertTrue(model.posts[0].mine)
        XCTAssertFalse(model.posts[1].mine)
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

    func testFestaFeaturesThePostAndTheFeedStaysChronological() async {
        let model = await model(makeCommunity("k1", "Fuglar", role: .moderator))
        XCTAssertEqual(model.posts.map(\.postId), ["p3", "p2"])
        XCTAssertTrue(model.featured.isEmpty)
        await model.pin("p1", true)
        XCTAssertTrue(social.calls.contains("pinPost k1 p1"))
        XCTAssertEqual(model.featured.map(\.postId), ["p1"])
        XCTAssertEqual(model.posts.map(\.postId), ["p3", "p2"])
        await model.pin("p2", true)
        XCTAssertEqual(model.featured.map(\.postId), ["p2", "p1"])
        XCTAssertEqual(model.posts.first(where: { $0.postId == "p2" })?.pinned, true)
        await model.pin("p1", false)
        XCTAssertTrue(social.calls.contains("unpinPost k1 p1"))
        XCTAssertEqual(model.featured.map(\.postId), ["p2"])
    }

    func testTheAsideTakesTheFeaturedPostsOutOfTheFeedAndKeepsTheOrder() async {
        let held = [makePost("p2", "k1", pinned: true)]
        let model = await model(
            makeCommunity("k1", "Fuglar", role: .member, featured: held),
            posts: [makePost("p3", "k1"), makePost("p2", "k1", pinned: true), makePost("p1", "k1")])
        XCTAssertEqual(model.feedPosts(aside: true).map(\.postId), ["p3"])
        await model.more()
        XCTAssertEqual(model.feedPosts(aside: true).map(\.postId), ["p3", "p1"])
    }

    func testTheStripLayoutsKeepTheFeedComplete() async {
        let held = [makePost("p2", "k1", pinned: true)]
        let model = await model(
            makeCommunity("k1", "Fuglar", role: .member, featured: held),
            posts: [makePost("p3", "k1"), makePost("p2", "k1", pinned: true), makePost("p1", "k1")])
        XCTAssertEqual(model.feedPosts(aside: false).map(\.postId), ["p3", "p2"])
    }

    func testASearchKeepsEveryPostEvenInTheAsideLayout() async {
        let held = [makePost("p2", "k1", body: "Lóa", pinned: true)]
        let model = await model(
            makeCommunity("k1", "Fuglar", role: .member, featured: held),
            posts: [makePost("p2", "k1", body: "Lóa", pinned: true), makePost("p1", "k1", body: "Annað")])
        model.query = "Lóa"
        await model.search()
        XCTAssertEqual(model.feedPosts(aside: true).map(\.postId), ["p2"])
    }

    func testAReleasedPostIsBackInTheFeedWhenTheFeaturedListChanges() async {
        let model = await model(makeCommunity("k1", "Fuglar", role: .moderator))
        await model.pin("p2", true)
        XCTAssertEqual(model.feedPosts(aside: true).map(\.postId), ["p3"])
        await model.pin("p2", false)
        XCTAssertEqual(model.feedPosts(aside: true).map(\.postId), ["p3", "p2"])
    }

    func testAFourthFeaturedPostIsRefusedWithTheFullProblem() async {
        let held = (7...9).map { makePost("p\($0)", "k1", pinned: true) }
        let model = await model(makeCommunity("k1", "Fuglar", role: .owner, featured: held))
        XCTAssertEqual(model.featured.count, 3)
        await model.pin("p1", true)
        XCTAssertEqual(model.problem, .pinFull)
        XCTAssertEqual(model.featured.count, 3)
    }

    func testAMemberCannotPinAPost() async {
        let model = await model(makeCommunity("k1", "Fuglar", role: .member))
        await model.pin("p1", true)
        XCTAssertFalse(social.calls.contains("pinPost k1 p1"))
    }

    func testTheComposerRowKnowsTheReadersOwnName() async {
        let model = await model(makeCommunity("k1", "Fuglar", role: .member))
        XCTAssertEqual(model.myName, "Jón Jónsson")
        XCTAssertNil(model.myPhoto)
    }

    // MARK: Tabs (decision 0089)

    func testAReaderSeesAllTabsAndFestOnlyWhileAPostIsFeatured() async {
        let model = await model(makeCommunity("k1", "Fuglar", role: .moderator))
        XCTAssertEqual(model.tabs, [.discussion, .images, .members, .about])
        XCTAssertEqual(model.shownTab, .discussion)
        await model.pin("p1", true)
        XCTAssertEqual(model.tabs, [.discussion, .featured, .images, .members, .about])
        model.select(.featured)
        XCTAssertEqual(model.shownTab, .featured)
        await model.pin("p1", false)
        XCTAssertEqual(model.shownTab, .discussion)
    }

    func testWhoMayNotReadSeesOnlyAbout() async {
        let model = await model(makeCommunity("k1", "Fiskar", audience: .private))
        XCTAssertEqual(model.tabs, [.about])
        model.select(.images)
        XCTAssertEqual(model.shownTab, .about)
    }

    func testTheGalleryPagesThroughTheCommunitiesImages() async {
        let model = await model(makeCommunity("k1", "Fuglar", role: .member))
        social.images["k1"] = (1...3).map {
            CommunityImage(
                mediaId: "m\($0)", postId: "p\($0)", commentId: nil, width: 4, height: 3, createdAt: UInt64($0))
        }
        await model.loadGallery()
        XCTAssertEqual(model.gallery.map(\.mediaId), ["m1", "m2"])
        XCTAssertNotNil(model.galleryNext)
        await model.moreGallery()
        XCTAssertEqual(model.gallery.map(\.mediaId), ["m1", "m2", "m3"])
        XCTAssertNil(model.galleryNext)
        XCTAssertTrue(model.galleryLoaded)
        await model.loadGallery()
        XCTAssertEqual(social.calls.filter { $0.hasPrefix("communityImages") }.count, 2)
    }

    // MARK: Polls (decision 0090)

    private func openPoll(closed: Bool = false) -> Poll {
        Poll(
            options: [
                PollOption(optionId: "o0", text: "Já", votes: nil), PollOption(optionId: "o1", text: "Nei", votes: nil),
            ], total: 0, mine: nil, closed: closed)
    }

    func testAPollNeedsItsQuestionAndTwoToSixDistinctOptions() {
        let can = CommunityModel.canPublishPoll
        XCTAssertTrue(can("Hvað?", ["Já", "Nei"]))
        XCTAssertFalse(can("  ", ["Já", "Nei"]))
        XCTAssertFalse(can("Hvað?", ["Já"]))
        XCTAssertFalse(can("Hvað?", ["Já", " "]))
        XCTAssertFalse(can("Hvað?", ["Já", " já "]))
        XCTAssertFalse(can("Hvað?", ["Já", String(repeating: "a", count: 81)]))
        XCTAssertTrue(can("Hvað?", ["Já", String(repeating: "a", count: 80)]))
        XCTAssertTrue(can("Hvað?", (1...6).map { "v\($0)" }))
        XCTAssertFalse(can("Hvað?", (1...7).map { "v\($0)" }))
    }

    func testAPollPostGoesOutWithTrimmedOptionsAndTakesNoImage() async {
        let model = await model(makeCommunity("k1", "Fuglar", role: .member))
        model.setPoll(true)
        XCTAssertEqual(model.pollFields, ["", ""])
        model.draft = "Hvað er best?"
        XCTAssertFalse(model.sendable)
        model.pollFields = [" Lóa ", "Spói"]
        XCTAssertTrue(model.sendable)
        XCTAssertFalse(model.roomForImage())
        model.addPollOption()
        XCTAssertEqual(model.pollFields?.count, 3)
        model.removePollOption(at: 2)
        XCTAssertEqual(model.pollFields?.count, 2)
        model.removePollOption(at: 1)
        XCTAssertEqual(model.pollFields?.count, 2)
        let posted = await model.publish()
        XCTAssertTrue(posted)
        XCTAssertTrue(social.calls.contains("createPost k1 Hvað er best? poll Lóa,Spói"))
        XCTAssertNil(model.pollFields)
        XCTAssertEqual(model.posts.first?.poll?.options.map(\.text), ["Lóa", "Spói"])
    }

    func testAVoteShowsTheResultsAndCanBeTakenBack() async {
        let model = await model(
            makeCommunity("k1", "Fuglar", role: .member), posts: [makePost("p1", "k1", poll: openPoll())])
        await model.vote("p1", option: "o1")
        var poll = model.posts[0].poll
        XCTAssertEqual(poll?.mine, "o1")
        XCTAssertEqual(poll.map(pollShowsResults), true)
        XCTAssertEqual(poll?.options.map(\.votes), [0, 1])
        await model.withdrawVote("p1")
        poll = model.posts[0].poll
        XCTAssertNil(poll?.mine)
        XCTAssertEqual(poll?.total, 0)
    }

    func testOnlyTheAuthorOrAModeratorClosesAPollAndItClosesForGood() async {
        let theirs = makePost("p1", "k1", poll: openPoll())
        let mine = makePost("p2", "k1", author: jon, poll: openPoll())
        let member = await model(makeCommunity("k1", "Fuglar", role: .member), posts: [theirs, mine])
        XCTAssertFalse(member.canClose(theirs))
        XCTAssertTrue(member.canClose(mine))
        let moderator = await model(makeCommunity("k1", "Fuglar", role: .moderator), posts: [theirs, mine])
        XCTAssertTrue(moderator.canClose(theirs))
        await moderator.closePoll("p1")
        XCTAssertEqual(moderator.posts[0].poll?.closed, true)
        XCTAssertEqual(moderator.posts[0].poll.map(pollShowsResults), true)
        XCTAssertFalse(moderator.canClose(moderator.posts[0]))
        await moderator.vote("p1", option: "o0")
        XCTAssertEqual(moderator.problem, .pollClosed)
    }

    func testTheAnonymousPostsWaitingAreCountedForAModeratorOnly() async {
        let moderator = await model(
            makeCommunity("k1", "Fuglar", role: .moderator, openReports: 1, anonymousPosts: true, pendingAnonymous: 2))
        XCTAssertEqual(moderator.pendingAnonymous, 2)
        XCTAssertEqual(moderator.manageCount, 3)
        let member = await model(
            makeCommunity("k2", "Fuglar", role: .member, anonymousPosts: true, pendingAnonymous: 2))
        XCTAssertEqual(member.pendingAnonymous, 0)
        XCTAssertEqual(member.manageCount, 0)
    }

    func testOnlyTheOwnerSwitchesAnonymousPostsOn() async {
        let moderator = await model(makeCommunity("k1", "Fuglar", role: .moderator))
        await moderator.setAnonymous(true)
        XCTAssertFalse(social.calls.contains("setAnonymousPosts k1 true"))
        let owner = await model(makeCommunity("k2", "Fuglar", role: .owner))
        XCTAssertFalse(owner.allowsAnonymous)
        await owner.setAnonymous(true)
        XCTAssertTrue(social.calls.contains("setAnonymousPosts k2 true"))
        XCTAssertEqual(owner.community?.anonymousPosts, true)
        XCTAssertTrue(owner.allowsAnonymous)
    }

    func testAnAnonymousPostWaitsForApprovalAndShowsNoName() async {
        let model = await model(makeCommunity("k1", "Fuglar", role: .member, anonymousPosts: true))
        model.draft = "Leyndarmál"
        model.anonymous = true
        await model.publish()
        XCTAssertTrue(social.calls.contains("createPost k1 Leyndarmál anonymous"))
        XCTAssertEqual(model.posts.first?.state, .pending)
        XCTAssertNil(model.posts.first?.author)
        XCTAssertFalse(model.anonymous)
    }

    func testAnAnonymousDraftGoesOutNamedWhereTheSwitchIsOff() async {
        let model = await model(makeCommunity("k1", "Fuglar", role: .member))
        model.draft = "Leyndarmál"
        model.anonymous = true
        await model.publish()
        // The switch is off, so the post goes out under the author's name.
        XCTAssertFalse(social.calls.contains("createPost k1 Leyndarmál anonymous"))
    }
}
