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
        // An emoji is one code point, so a note of them runs to the same limit.
        model.note = String(repeating: "\u{1F600}", count: limit)
        XCTAssertTrue(model.sendable)
        model.note += "\u{1F600}"
        XCTAssertFalse(model.sendable)
        XCTAssertEqual(textLength(ReportModel.capped(model.note)), limit)
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
