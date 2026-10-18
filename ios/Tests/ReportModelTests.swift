import SpjallCore
import XCTest

@testable import Spjall

@MainActor
final class ReportModelTests: XCTestCase {
    private let social = FakeSocial()

    func testAReportNeedsAReasonThenThanks() async {
        let model = ReportModel(social: social, target: ReportTarget(kind: .post, id: "p1"))
        XCTAssertFalse(model.sendable)
        await model.send()
        XCTAssertEqual(social.calls, [])
        model.reason = .harassment
        model.note = "  Aftur og aftur "
        await model.send()
        XCTAssertEqual(social.calls, ["report post p1 harassment Aftur og aftur"])
        XCTAssertTrue(model.sent)
        XCTAssertFalse(model.sendable)
    }

    func testAFailedReportCanBeSentAgain() async {
        let model = ReportModel(social: social, target: ReportTarget(kind: .comment, id: "c1"))
        model.reason = .spam
        social.failNext = unreachable
        await model.send()
        XCTAssertFalse(model.sent)
        XCTAssertEqual(model.problem, .unreachable)
        await model.send()
        XCTAssertTrue(model.sent)
        XCTAssertNil(model.problem)
    }
}
