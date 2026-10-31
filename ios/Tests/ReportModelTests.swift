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

    func testANoteStopsWhereTheServerDoes() {
        let model = ReportModel(social: social, target: ReportTarget(kind: .post, id: "p1"))
        model.reason = .spam
        let limit = ReportModel.noteLimit
        model.note = String(repeating: "a", count: limit)
        XCTAssertTrue(model.sendable)
        model.note += "a"
        XCTAssertFalse(model.sendable)
        // An emoji is one character here and two units on the server.
        model.note = String(repeating: "\u{1F600}", count: limit / 2 + 1)
        XCTAssertFalse(model.sendable)
        XCTAssertEqual(ReportModel.capped(model.note).utf16.count, limit)
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
