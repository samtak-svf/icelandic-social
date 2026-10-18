import SpjallCore
import XCTest

@testable import Spjall

@MainActor
final class ReportsModelTests: XCTestCase {
    private let social = FakeSocial()

    private func model() async -> ReportsModel {
        social.reports = [
            "k1": [
                makeReport("r1", in: "k1", .post, "p1"), makeReport("r2", in: "k1", .comment, "c1"),
                makeReport("r3", in: "k1", .account, "a2"),
            ]
        ]
        social.cards = [
            "p1": .post(
                reference: CardRef(kind: .post, id: "p1"), community: CardCommunity(communityId: "k1", name: "Fuglar"),
                author: anna, excerpt: "Kaupið núna", image: nil, createdAt: FakeAccount.now)
        ]
        let model = ReportsModel(social: social, communityId: "k1")
        await model.load()
        return model
    }

    func testShowsTheOpenReportsWithTheCardsOfWhatTheyReported() async {
        let model = await model()
        XCTAssertEqual(model.reports.map(\.reportId), ["r1", "r2"])
        XCTAssertTrue(social.calls.contains("cards p1,c1"))
        if case .post(_, _, _, let excerpt, _, _) = model.cards["p1"] {
            XCTAssertEqual(excerpt, "Kaupið núna")
        } else {
            XCTFail("no card for p1")
        }
        XCTAssertEqual(model.cards["c1"], .unavailable(reference: CardRef(kind: .comment, id: "c1")))
        await model.more()
        XCTAssertEqual(model.reports.map(\.reportId), ["r1", "r2", "r3"])
    }

    func testHidingAPostAnswersItsReportAndTheQueueMovesOn() async {
        let model = await model()
        await model.act(model.reports[0], remove: false, reason: " Auglýsing ")
        XCTAssertTrue(social.calls.contains("moderate k1 hidePost p1 Auglýsing r1"))
        XCTAssertTrue(model.done)
        XCTAssertEqual(model.reports.map(\.reportId), ["r2", "r3"])
    }

    func testRemovingACommentNamesTheComment() async {
        let model = await model()
        await model.act(model.reports[1], remove: true, reason: "Áreitni")
        XCTAssertTrue(social.calls.contains("moderate k1 removeComment c1 Áreitni r2"))
    }

    func testClosingAReportActsOnNothing() async {
        let model = await model()
        await model.dismiss(model.reports[0], reason: "Í lagi")
        XCTAssertTrue(social.calls.contains("closeReport r1 Í lagi"))
        XCTAssertFalse(social.calls.contains { $0.hasPrefix("moderate") })
        XCTAssertEqual(model.reports.map(\.reportId), ["r2", "r3"])
    }

    func testNothingHappensWithoutAReason() async {
        let model = await model()
        await model.act(model.reports[0], remove: false, reason: "   ")
        await model.dismiss(model.reports[0], reason: "")
        XCTAssertFalse(social.calls.contains { $0.hasPrefix("moderate") || $0.hasPrefix("closeReport") })
        XCTAssertFalse(ReportsModel.valid(String(repeating: "a", count: ReportsModel.reasonLimit + 1)))
    }

    func testAnAccountIsOnlyClosedNeverHidden() async {
        let model = await model()
        await model.more()
        await model.act(model.reports[2], remove: false, reason: "Ruslpóstur")
        XCTAssertFalse(social.calls.contains { $0.hasPrefix("moderate") })
    }

    func testAFailedActionKeepsTheReportAndRetries() async {
        let model = await model()
        social.failNext = unreachable
        await model.dismiss(model.reports[0], reason: "Í lagi")
        XCTAssertEqual(model.problem, .unreachable)
        XCTAssertFalse(model.done)
        XCTAssertEqual(model.reports.count, 2)
        await model.retry()
        XCTAssertNil(model.problem)
        XCTAssertEqual(model.reports.map(\.reportId), ["r2", "r3"])
    }
}
