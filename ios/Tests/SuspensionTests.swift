import SpjallCore
import XCTest

@testable import Spjall

/// A suspended account: the notice, the refusal and the model that reads it (decision 0115).
@MainActor
final class SuspensionTests: XCTestCase {
    private nonisolated static let fixed = Date(timeIntervalSince1970: 1_800_000_000)
    private var now: Date { Self.fixed }

    private func millis(_ date: Date) -> UInt64 { UInt64(date.timeIntervalSince1970 * 1_000) }

    private func me(_ suspension: AccountSuspension?) -> Me {
        Me(
            accountId: "a1", name: nil, verified: true, devices: [], photo: nil, suspension: suspension,
            platformModerator: false)
    }

    func testAnEndedSuspensionNoLongerStands() {
        let past = AccountSuspension(until: millis(now.addingTimeInterval(-60)))
        let future = AccountSuspension(until: millis(now.addingTimeInterval(60)))
        let open = AccountSuspension(until: nil)
        XCTAssertNil(standingSuspension(me(nil), now: now))
        XCTAssertNil(standingSuspension(me(past), now: now))
        XCTAssertEqual(standingSuspension(me(future), now: now), future)
        XCTAssertEqual(standingSuspension(me(open), now: now), open)
    }

    /// Like, comment, post, vote, join and create all ask `mayWrite`: allowed without a suspension, never with one,
    /// whether or not it has an end, and still as their own condition says without one.
    func testEveryControlThatWritesIsOffUnderASuspension() {
        let ends = AccountSuspension(until: millis(now.addingTimeInterval(60)))
        let open = AccountSuspension(until: nil)
        XCTAssertTrue(mayWrite(nil))
        XCTAssertTrue(mayWrite(nil, true))
        XCTAssertFalse(mayWrite(nil, false))
        for suspension in [ends, open] {
            XCTAssertFalse(mayWrite(suspension))
            XCTAssertFalse(mayWrite(suspension, true))
            XCTAssertFalse(mayWrite(suspension, false))
        }
    }

    func testTheModelFollowsWhatTheServerReports() async {
        let social = FakeSocial()
        let model = SuspensionModel(social: social, now: { Self.fixed })
        await model.load()
        XCTAssertNil(model.suspension)
        social.mySuspension = AccountSuspension(until: nil)
        await model.load()
        XCTAssertEqual(model.suspension, AccountSuspension(until: nil))
        social.mySuspension = nil
        await model.load()
        XCTAssertNil(model.suspension)
    }

    func testAFailedReadKeepsTheNoticeItHad() async {
        let social = FakeSocial()
        social.mySuspension = AccountSuspension(until: nil)
        let model = SuspensionModel(social: social, now: { Self.fixed })
        await model.load()
        social.failNext = CoreError.Unreachable(detail: "no answer")
        await model.load()
        XCTAssertNotNil(model.suspension)
    }

    func testTheNoticeAndTheRefusalNameTheEndOrNone() {
        let end: UInt64 = 1_800_000_000_000
        XCTAssertEqual(
            suspendedNoticeText(AccountSuspension(until: end)),
            localized("suspended_notice_until", Dates.dateTime(Dates.at(end))))
        XCTAssertEqual(suspendedNoticeText(AccountSuspension(until: nil)), localized("suspended_notice"))
        XCTAssertEqual(
            suspendedProblemText(AccountSuspension(until: end)),
            localized("problem_suspended_until", Dates.dateTime(Dates.at(end))))
        XCTAssertEqual(suspendedProblemText(nil), localized("problem_suspended"))
    }

    func testTheRefusalCodeSuspendedIsItsOwnProblem() {
        let problem = Problem(CoreError.Refused(status: 403, code: "suspended", requestId: "r1"))
        XCTAssertEqual(problem, .suspended)
        XCTAssertEqual(ProblemCard.messageKey(problem), "problem_suspended")
        XCTAssertFalse(problem.canRetry)
        XCTAssertNil(problem.requestId)
    }
}
