import SpjallCore
import XCTest

@testable import Spjall

@MainActor
final class StatementsModelTests: XCTestCase {
    private let social = FakeSocial()

    private func statement(_ id: UInt64, canAsk: Bool = true) -> ModerationStatement {
        ModerationStatement(
            entryId: id, action: .removePost, target: LogTarget(kind: .post, id: "p\(id)"), communityId: "k1",
            reason: "Ástæða", createdAt: 1, body: "Texti", canAsk: canAsk, review: nil)
    }

    private func model() async -> StatementsModel {
        let model = StatementsModel(social: social)
        await model.load()
        return model
    }

    func testListsTheStatementsAndSaysWhenThereAreNone() async {
        let none = await model()
        XCTAssertTrue(none.loaded)
        XCTAssertTrue(none.statements.isEmpty)
        social.statements = [statement(2), statement(1)]
        let some = await model()
        XCTAssertEqual(some.statements.map(\.entryId), [2, 1])
    }

    func testReadsThePagesInOrder() async {
        social.statements = [statement(3), statement(2), statement(1)]
        social.pageSize = 2
        let model = await model()
        XCTAssertEqual(model.statements.map(\.entryId), [3, 2])
        await model.more()
        XCTAssertEqual(model.statements.map(\.entryId), [3, 2, 1])
        XCTAssertNil(model.next)
    }

    func testAskingIsDoneOnceAndTheListIsAskedForAgain() async {
        social.statements = [statement(7)]
        let model = await model()
        await model.ask(7)
        XCTAssertTrue(social.calls.contains("askModerationReview 7"))
        XCTAssertFalse(model.statements[0].canAsk)
        XCTAssertEqual(model.statements[0].review?.state, .open)
    }

    func testAFailedAskKeepsTheListAndRetriesTheAsk() async {
        social.statements = [statement(7)]
        let model = await model()
        social.failOn = "askModerationReview"
        await model.ask(7)
        XCTAssertNotNil(model.problem)
        XCTAssertTrue(model.statements[0].canAsk)
        social.failOn = nil
        await model.retry()
        XCTAssertNil(model.problem)
        XCTAssertFalse(model.statements[0].canAsk)
    }

    func testAReviewReadsByItsStateAndWhetherTheContentCameBack() {
        func review(_ state: ModerationReviewState, restored: Bool = false) -> ModerationReview {
            ModerationReview(state: state, askedAt: 1, decidedAt: nil, reason: nil, restored: restored)
        }
        XCTAssertEqual(reviewSentence(review(.open), action: .removePost), localized("statement_review_open"))
        XCTAssertEqual(reviewSentence(review(.upheld), action: .removePost), localized("statement_review_upheld"))
        XCTAssertEqual(
            reviewSentence(review(.overturned, restored: true), action: .removePost),
            localized("statement_review_overturned"))
        XCTAssertEqual(
            reviewSentence(review(.overturned), action: .removePost),
            localized("statement_review_overturned_not_restored"))
        XCTAssertNil(reviewSentence(review(.unknown), action: .removePost))
    }

    func testAnOverturnedSuspensionSaysWhetherItIsLiftedOrStillStands() {
        func overturned(restored: Bool) -> ModerationReview {
            ModerationReview(state: .overturned, askedAt: 1, decidedAt: nil, reason: nil, restored: restored)
        }
        XCTAssertEqual(
            reviewSentence(overturned(restored: true), action: .suspendAccount),
            localized("statement_review_overturned_lifted"))
        XCTAssertEqual(
            reviewSentence(overturned(restored: false), action: .suspendAccount),
            localized("statement_review_overturned_later_stands"))
    }

    func testASuspensionStatementNamesItsEndOrSaysItHasNone() {
        let end: UInt64 = 1_800_000_000_000
        XCTAssertEqual(
            statementLabel(.suspendAccount, until: end),
            localized("moderation_decision_suspend_account_until", Dates.dateTime(Dates.at(end))))
        XCTAssertEqual(
            statementLabel(.suspendAccount, until: nil), localized("moderation_decision_suspend_account_open"))
        XCTAssertEqual(
            statementLabel(.unsuspendAccount), localized("moderation_decision_unsuspend_account"))
    }

    func testAnActionALaterServerAddsReadsAsDone() {
        XCTAssertEqual(statementLabel(.removePost), localized("moderation_decision_remove_post"))
        XCTAssertEqual(statementLabel(.clearAccountPhoto), localized("moderation_decision_clear_account_photo"))
        XCTAssertEqual(statementLabel(.unknown), localized("moderation_done"))
    }

    func testAReviewAndAClearedPhotoHaveTheirOwnSentences() {
        func key(_ action: NotificationAction) -> String {
            noticeWording(kind: .moderated, names: [], actorCount: 0, action: action).key
        }
        XCTAssertEqual(key(.reviewUpheld), "notice_review_upheld")
        XCTAssertEqual(key(.reviewOverturned), "notice_review_overturned")
        XCTAssertEqual(key(.clearAccountPhoto), "notice_account_photo_cleared")
        XCTAssertEqual(key(.removePost), "notice_moderated")
    }

    func testOnlyAnEmptyRemovedPostIsATombstone() {
        let removed = makePost("p1", "k1", body: "", author: nil, state: .removed)
        XCTAssertTrue(isPostTombstone(removed))
        XCTAssertFalse(isPostTombstone(makePost("p1", "k1", state: .removed)))
        XCTAssertFalse(isPostTombstone(makePost("p1", "k1", body: "", author: nil)))
        XCTAssertFalse(isPostTombstone(makePost("p1", "k1", body: "", author: nil, anonymous: true, state: .removed)))
    }

    func testATombstonesScreenAsksForNoCommentsAndWritesNothing() async {
        // The comments' route refuses this reader, and the community may be one they left.
        social.posts = ["k1": [makePost("p1", "k1", body: "", author: nil, state: .removed)]]
        let model = PostModel(social: social, postId: "p1")
        await model.load()
        XCTAssertNil(model.problem)
        XCTAssertEqual(model.post?.postId, "p1")
        XCTAssertTrue(model.comments.isEmpty)
        XCTAssertFalse(model.writes)
        XCTAssertFalse(social.calls.contains { $0.hasPrefix("comments ") || $0.hasPrefix("community ") })
    }
}
