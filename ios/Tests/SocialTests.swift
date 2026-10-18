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
        XCTAssertEqual(moderation(.post, remove: false), .hidePost)
        XCTAssertEqual(moderation(.post, remove: true), .removePost)
        XCTAssertEqual(moderation(.comment, remove: false), .hideComment)
        XCTAssertEqual(moderation(.comment, remove: true), .removeComment)
        XCTAssertNil(moderation(.community, remove: false))
        XCTAssertNil(moderation(.account, remove: true))
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
}
