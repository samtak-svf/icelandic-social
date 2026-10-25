import SpjallCore
import XCTest

@testable import Spjall

/// The pure helpers the hosted screens share.
final class SocialTests: XCTestCase {
    func testAReactionMovesTheCountsToMatch() {
        let counted = makePost("p1", "k1", reactions: [ReactionCount(kind: .like, count: 2)])
        let liked = reacted(counted, .like)
        XCTAssertEqual(liked.myReaction, .like)
        XCTAssertEqual(reactionCount(liked, .like), 3)

        let loved = reacted(liked, .love)
        XCTAssertEqual(loved.myReaction, .love)
        XCTAssertEqual(reactionCount(loved, .like), 2)
        XCTAssertEqual(reactionCount(loved, .love), 1)

        let off = reacted(loved, nil)
        XCTAssertNil(off.myReaction)
        XCTAssertEqual(off.reactions, [ReactionCount(kind: .like, count: 2)])
    }

    func testTakingTheOnlyReactionOffLeavesNoCountAtZero() {
        let mine = makePost("p1", "k1", reactions: [ReactionCount(kind: .sad, count: 1)], mine: .sad)
        XCTAssertEqual(reacted(mine, nil).reactions, [])
    }

    func testAnAuthorIsTheirNameOrAWordForNoneOrForDeleted() {
        XCTAssertEqual(authorName(anna), "Anna")
        XCTAssertEqual(authorName(Author(accountId: "a3", name: nil, verified: false)), localized("person_unnamed"))
        XCTAssertEqual(authorName(nil), localized("person_deleted"))
    }

    func testAnAnonymousPostIsBylinedFromMineNeverFromTheAuthor() {
        XCTAssertNil(anonymousByline(makePost("p1", "k1")))
        XCTAssertNil(anonymousByline(makePost("p1", "k1", author: jon)))
        XCTAssertEqual(
            anonymousByline(makePost("p1", "k1", author: nil, anonymous: true, own: false)),
            localized("post_anonymous_author"))
        XCTAssertEqual(
            anonymousByline(makePost("p1", "k1", author: nil, anonymous: true, own: true)),
            localized("post_anonymous_mine"))
    }

    func testACardWithNoAuthorIsBylinedAnonymous() {
        XCTAssertEqual(cardByline(anna), "Anna")
        XCTAssertEqual(cardByline(nil), localized("post_anonymous_author"))
    }

    func testANotificationOpensItsPostUnlessAModeratorActedOnIt() {
        XCTAssertEqual(noticeRoute(makeNotice("n1", .comment, post: "p1")), .post("p1"))
        XCTAssertEqual(noticeRoute(makeNotice("n2", .reaction, post: "p1")), .post("p1"))
        XCTAssertEqual(noticeRoute(makeNotice("n3", .moderated, post: "p1")), .community("k1"))
        XCTAssertEqual(noticeRoute(makeNotice("n4", .joinApproved)), .community("k1"))
    }

    func testANotificationNamesWhoDidIt() {
        let comment = makeNotice("n1", .comment, actor: anna, post: "p1")
        XCTAssertEqual(noticeLine(comment), localized("notice_comment", "Anna"))
        XCTAssertTrue(noticeLine(comment).contains("Anna"))
        let gone = makeNotice("n2", .reaction, post: "p1")
        XCTAssertTrue(noticeLine(gone).contains(localized("person_deleted")))
        XCTAssertEqual(noticeLine(makeNotice("n3", .joinApproved)), localized("notice_join_approved"))
    }

    func testOnlyAPostOrACommentIsHiddenOrRemoved() {
        let post = makeReport("r1", in: "k1", .post, "p1")
        let comment = makeReport("r2", in: "k1", .comment, "c1")
        XCTAssertEqual(moderation(post, .hide), .hidePost)
        XCTAssertEqual(moderation(post, .remove), .removePost)
        XCTAssertEqual(moderation(post, .restore), .restorePost)
        XCTAssertEqual(moderation(comment, .hide), .hideComment)
        XCTAssertEqual(moderation(comment, .remove), .removeComment)
        XCTAssertNil(moderation(makeReport("r3", in: "k1", .community, "k1"), .hide))
        XCTAssertNil(moderation(makeReport("r4", in: "k1", .account, "a2"), .remove))
        XCTAssertEqual(moderation(post, .mute), .muteMember)
        XCTAssertEqual(moderation(post, .unban), .unbanMember)
        XCTAssertNil(cardRef(ReportTarget(kind: .account, id: "a2")))
        XCTAssertEqual(cardRef(ReportTarget(kind: .comment, id: "c1")), CardRef(kind: .comment, id: "c1"))
    }

    func testAMemberWritesUnlessMutedOrReadOnly() {
        let now = FakeAccount.now
        XCTAssertFalse(canWrite(makeCommunity("k1", "Fuglar"), now: now))
        XCTAssertTrue(canWrite(makeCommunity("k1", "Fuglar", role: .member), now: now))
        XCTAssertFalse(canWrite(makeCommunity("k1", "Fuglar", role: .member, readOnly: true), now: now))
        let muted = makeCommunity("k1", "Fuglar", role: .member, mutedUntil: now + 1)
        XCTAssertTrue(isMuted(muted, now: now))
        XCTAssertFalse(canWrite(muted, now: now))
        let ended = makeCommunity("k1", "Fuglar", role: .member, mutedUntil: now - 1)
        XCTAssertFalse(isMuted(ended, now: now))
        XCTAssertTrue(canWrite(ended, now: now))
    }

    func testEachReasonAndReactionHasItsOwnWords() {
        XCTAssertEqual(Set(reportReasons.map(reasonLabel)).count, reportReasons.count)
        XCTAssertEqual(Set(reactionKinds.map(reactionLabel)).count, reactionKinds.count)
        XCTAssertEqual(Set(reactionKinds.map(reactionEmoji)).count, reactionKinds.count)
    }

    func testEachRoleHasItsOwnWords() {
        let roles: [CommunityRole] = [.owner, .moderator, .member]
        XCTAssertEqual(Set(roles.map(roleLabel)).count, roles.count)
    }

    func testAThreadIsItsTopLevelCommentsWithTheRepliesEachTook() {
        let threads = commentThreads([
            makeComment("c1", on: "p1"), makeComment("c2", on: "p1", parent: "c1"),
            makeComment("c3", on: "p1"), makeComment("c4", on: "p1", parent: "c3"),
        ])
        XCTAssertEqual(threads.map(\.comment.commentId), ["c1", "c3"])
        XCTAssertEqual(threads[0].replies.map(\.commentId), ["c2"])
        XCTAssertEqual(threads[1].replies.map(\.commentId), ["c4"])
    }

    func testAReplyWhoseParentIsNotShownStandsOnItsOwn() {
        let threads = commentThreads([makeComment("c9", on: "p1", parent: "c1")])
        XCTAssertEqual(threads.map(\.comment.commentId), ["c9"])
        XCTAssertTrue(threads[0].replies.isEmpty)
    }

    func testARemovedCommentWithNoTextIsATombstone() {
        XCTAssertTrue(isTombstone(makeComment("c1", on: "p1", body: "", state: .removed)))
        XCTAssertFalse(isTombstone(makeComment("c2", on: "p1", body: "Já", state: .removed)))
        XCTAssertFalse(isTombstone(makeComment("c3", on: "p1")))
    }

    func testEveryModerationLogActionButTheServerUnknownOneHasItsWords() {
        let actions: [ModerationLogAction] = [
            .hidePost, .removePost, .restorePost, .hideComment, .removeComment, .restoreComment,
            .muteMember, .unmuteMember, .removeMember, .banMember, .unbanMember, .closeReport,
            .deleteCommunity, .restoreCommunity,
        ]
        XCTAssertEqual(actions.compactMap(logActionLabel).count, actions.count)
        XCTAssertNil(logActionLabel(.unknown))
        XCTAssertEqual(logActionLabel(.closeReport), localized("moderation_decision_dismissed"))
        XCTAssertEqual(logActionLabel(.restoreCommunity), localized("moderation_restore"))
    }

    func testAPollShareIsAWholePercentageOfTheTotal() {
        XCTAssertEqual(pollShare(votes: 1, total: 3), 33)
        XCTAssertEqual(pollShare(votes: 2, total: 3), 67)
        XCTAssertEqual(pollShare(votes: 1, total: 8), 13)
        XCTAssertEqual(pollShare(votes: 0, total: 0), 0)
    }

    func testResultsShowOnlyWhenEveryCountCameWithThePoll() {
        let hidden = Poll(
            options: [
                PollOption(optionId: "a", text: "A", votes: nil), PollOption(optionId: "b", text: "B", votes: nil),
            ], total: 3, mine: nil, closed: false)
        XCTAssertFalse(pollShowsResults(hidden))
        var shown = hidden
        shown.options = shown.options.map { PollOption(optionId: $0.optionId, text: $0.text, votes: 1) }
        XCTAssertTrue(pollShowsResults(shown))
        shown.options[0].votes = nil
        XCTAssertFalse(pollShowsResults(shown))
    }
}
