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
        let model = ReportsModel(social: social, communityId: "k1", now: { FakeAccount.now })
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
        await model.act(model.reports[0], .hide, reason: " Auglýsing ")
        XCTAssertTrue(social.calls.contains("moderate k1 hidePost p1 Auglýsing r1"))
        XCTAssertTrue(model.done)
        XCTAssertEqual(model.reports.map(\.reportId), ["r2", "r3"])
    }

    func testRemovingACommentNamesTheComment() async {
        let model = await model()
        await model.act(model.reports[1], .remove, reason: "Áreitni")
        XCTAssertTrue(social.calls.contains("moderate k1 removeComment c1 Áreitni r2"))
    }

    func testClosingAReportActsOnNothing() async {
        let model = await model()
        await model.act(model.reports[0], .dismiss, reason: "Í lagi")
        XCTAssertTrue(social.calls.contains("closeReport r1 Í lagi"))
        XCTAssertFalse(social.calls.contains { $0.hasPrefix("moderate") })
        XCTAssertEqual(model.reports.map(\.reportId), ["r2", "r3"])
    }

    func testNothingHappensWithoutAReason() async {
        let model = await model()
        await model.act(model.reports[0], .hide, reason: "   ")
        await model.act(model.reports[0], .dismiss, reason: "")
        XCTAssertFalse(social.calls.contains { $0.hasPrefix("moderate") || $0.hasPrefix("closeReport") })
        XCTAssertFalse(ReportsModel.valid(String(repeating: "a", count: ReportsModel.reasonLimit + 1)))
    }

    func testAnAccountIsOnlyClosedNeverHidden() async {
        let model = await model()
        await model.more()
        await model.act(model.reports[2], .hide, reason: "Ruslpóstur")
        XCTAssertFalse(social.calls.contains { $0.hasPrefix("moderate") })
    }

    func testAFailedActionKeepsTheReportAndRetries() async {
        let model = await model()
        social.failNext = unreachable
        await model.act(model.reports[0], .dismiss, reason: "Í lagi")
        XCTAssertEqual(model.problem, .unreachable)
        XCTAssertFalse(model.done)
        XCTAssertEqual(model.reports.count, 2)
        await model.retry()
        XCTAssertNil(model.problem)
        XCTAssertEqual(model.reports.map(\.reportId), ["r2", "r3"])
    }

    func testAMuteForAWeekEndsSevenDaysFromNow() async {
        let model = await model()
        await model.act(model.reports[0], .mute, reason: "Ruslpóstur", period: .week)
        let until = FakeAccount.now + 7 * 86_400_000
        XCTAssertTrue(social.calls.contains("moderate k1 muteMember a2 Ruslpóstur r1 \(until)"))
        XCTAssertEqual(MutePeriod.day.until(0), 86_400_000)
        XCTAssertEqual(MutePeriod.month.until(0), 30 * 86_400_000)
    }

    func testAMuteWithoutAPeriodSendsNothing() async {
        let model = await model()
        await model.act(model.reports[0], .mute, reason: "Ruslpóstur")
        XCTAssertFalse(social.calls.contains { $0.hasPrefix("moderate") })
        XCTAssertFalse(model.done)
    }

    func testTheMemberVerbsActOnTheAuthor() async {
        let model = await model()
        await model.act(model.reports[1], .unmute, reason: "Lokið")
        XCTAssertTrue(social.calls.contains("moderate k1 unmuteMember a2 Lokið r2"))
        await model.act(model.reports[0], .ban, reason: "Ítrekað")
        XCTAssertTrue(social.calls.contains("moderate k1 banMember a2 Ítrekað r1"))
        XCTAssertEqual(model.reports.map(\.reportId), ["r3"])
        await model.act(model.reports[0], .unban, reason: "Fyrirgefið")
        XCTAssertTrue(social.calls.contains("moderate k1 unbanMember a2 Fyrirgefið r3"))
    }

    func testAnAccountReportActsOnTheAccount() async {
        social.reports = ["k1": [makeReport("r9", in: "k1", .account, "a3", author: nil)]]
        let model = ReportsModel(social: social, communityId: "k1", now: { FakeAccount.now })
        await model.load()
        await model.act(model.reports[0], .ban, reason: "Ruslpóstur")
        XCTAssertTrue(social.calls.contains("moderate k1 banMember a3 Ruslpóstur r9"))
    }

    func testADeletedAuthorIsNotMutedOrBanned() async {
        let gone = makeReport("r9", in: "k1", .post, "p9", author: nil)
        XCTAssertNil(moderation(gone, .mute))
        XCTAssertNil(moderation(gone, .ban))
        XCTAssertEqual(moderation(gone, .hide), .hidePost)
        social.reports = ["k1": [gone]]
        let model = ReportsModel(social: social, communityId: "k1", now: { FakeAccount.now })
        await model.load()
        await model.act(model.reports[0], .ban, reason: "Ruslpóstur")
        XCTAssertFalse(social.calls.contains { $0.hasPrefix("moderate") })
    }

    func testTheClosedReportsShowInsteadAndARestoreAnswersNone() async {
        let model = await model()
        await model.act(model.reports[0], .hide, reason: "Auglýsing")
        XCTAssertEqual(model.showing, .open)
        await model.show(.closed)
        XCTAssertEqual(model.showing, .closed)
        XCTAssertTrue(social.calls.contains("reports k1 closed -"))
        XCTAssertEqual(model.reports.map(\.reportId), ["r1"])
        await model.act(model.reports[0], .restore, reason: "Mistök")
        XCTAssertTrue(social.calls.contains("moderate k1 restorePost p1 Mistök -"))
        let before = social.calls.count
        await model.act(model.reports[0], .dismiss, reason: "Í lagi")
        XCTAssertEqual(social.calls.count, before)
        await model.show(.open)
        XCTAssertEqual(model.reports.map(\.reportId), ["r2", "r3"])
    }

    func testRestoringACommentNamesTheComment() {
        let report = makeReport("r2", in: "k1", .comment, "c1", state: .closed)
        XCTAssertEqual(moderation(report, .restore), .restoreComment)
        XCTAssertEqual(moderation(report, .remove), .removeComment)
        XCTAssertNil(moderation(report, .dismiss))
    }
}
