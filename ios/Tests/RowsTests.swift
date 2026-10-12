import SpjallCore
import XCTest

@testable import Spjall

final class RowsTests: XCTestCase {
    private let day: UInt64 = 1_700_000_000_000  // 2023-11-14 22:13 UTC
    private let morning: UInt64 = 1_699_956_800_000  // 2023-11-14 10:13 UTC
    private let minute: UInt64 = 60_000
    private let anna = person("a2", "Anna")
    private let me = person("a1", "Jón")
    private var utc: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }

    private func shape(_ rows: [Row]) -> [String] {
        rows.map {
            switch $0 {
            case .time(_, let before): "time \(before.seq.map(String.init) ?? "nil")"
            case .card(let item): "card \(item.seq ?? 0)"
            case .bubble(let item, let first, let last, let readBy):
                "\(item.seq.map(String.init) ?? "nil")\(first ? " first" : "")\(readBy.map { " read \($0)" } ?? "")"
                    + (last ? " last" : "")
            }
        }
    }

    func testRunsFromOneSenderWithinFiveMinutesGoTogether() {
        let rows = rows(
            [
                item(1, sender: anna, ts: day),
                item(2, sender: anna, ts: day + 5 * minute),
                item(3, sender: anna, ts: day + 11 * minute),
                item(4, sender: me, own: true, ts: day + 12 * minute),
            ], calendar: utc)
        XCTAssertEqual(shape(rows), ["time 1", "1 first", "2 last", "3 first last", "4 first last"])
    }

    func testATimeLineNamesTheTimeOfTheItemItComesBefore() {
        let rows = rows([item(1, ts: day)], calendar: utc)
        guard case .time(let date, let before) = rows.first else { return XCTFail("no time line first") }
        XCTAssertEqual(before.seq, 1)
        XCTAssertEqual(date, Date(timeIntervalSince1970: 1_700_000_000))
    }

    func testANewDayAndACardBreakARun() {
        let rows = rows(
            [
                item(1, ts: day),
                item(2, ts: day + minute, content: .timer(seconds: 3_600)),
                item(3, ts: day + 2 * minute),
                item(4, ts: day + 120 * minute),
            ], calendar: utc)
        XCTAssertEqual(shape(rows), ["time 1", "1 first last", "card 2", "3 first last", "time 4", "4 first last"])
    }

    func testAnHourOrMoreAfterThePreviousItemGetsALine() {
        let rows = rows(
            [item(1, ts: morning), item(2, ts: morning + 59 * minute), item(3, ts: morning + 119 * minute)],
            calendar: utc)
        XCTAssertEqual(shape(rows), ["time 1", "1 first last", "2 first last", "time 3", "3 first last"])
    }

    func testAnEarlierClockThanThePreviousItemNeverGoesBack() {
        // Before decision 0048 this drew a line naming the earlier time.
        let rows = rows([item(1, ts: morning + 60 * minute), item(2, ts: morning)], calendar: utc)
        XCTAssertEqual(shape(rows), ["time 1", "1 first", "2 last"])
    }

    func testWithinAnHourOnTheSameDayThereIsNoLine() {
        let rows = rows(
            [item(1, ts: morning), item(2, ts: morning + 30 * minute), item(3, ts: morning + 80 * minute)],
            calendar: utc)
        XCTAssertEqual(shape(rows), ["time 1", "1 first last", "2 first last", "3 first last"])
    }

    func testTheGapIsMeasuredFromThePreviousItemOfAnyKind() {
        let rows = rows(
            [
                item(1, ts: morning),
                item(2, ts: morning + 70 * minute, content: .timer(seconds: 3_600)),
                item(3, ts: morning + 75 * minute),
            ], calendar: utc)
        XCTAssertEqual(shape(rows), ["time 1", "1 first last", "time 2", "card 2", "3 first last"])
    }

    func testServerTimesDrawTheLines() {
        // Decision 0048: the sender's clock was two hours behind; the server's was not.
        let skew = 120 * minute
        let rows = rows(
            [
                item(1, ts: day - skew, receivedAt: day),
                item(2, ts: day + minute - skew, receivedAt: day + minute),
                item(3, ts: day + 61 * minute - skew, receivedAt: day + 61 * minute),
            ], calendar: utc)
        XCTAssertEqual(shape(rows), ["time 1", "1 first", "2 last", "time 3", "3 first last"])
        guard case .time(let date, _) = rows.first else { return XCTFail("no time line first") }
        XCTAssertEqual(date, Date(timeIntervalSince1970: 1_700_000_000))
    }

    func testALateSenderClockDrawsNoLine() {
        let rows = rows(
            [
                item(1, ts: day, receivedAt: day),
                item(2, ts: day + 120 * minute, receivedAt: day + 120 * minute),
                item(3, ts: day + minute, receivedAt: day + 121 * minute),
                item(4, ts: day + 125 * minute, receivedAt: day + 125 * minute),
            ], calendar: utc)
        XCTAssertEqual(shape(rows), ["time 1", "1 first last", "time 2", "2 first", "3", "4 last"])
        XCTAssertEqual(Set(rows.map(\.id)).count, rows.count)
    }

    func testOldRowsFallBackToTheSendersClockButNeverGoBack() {
        let rows = rows(
            [
                item(1, ts: day),
                item(2, ts: day + 120 * minute),
                item(3, ts: day + minute),
                item(4, ts: day + 122 * minute, receivedAt: day + 122 * minute),
            ], calendar: utc)
        XCTAssertEqual(shape(rows), ["time 1", "1 first last", "time 2", "2 first", "3", "4 last"])
    }

    func testAPendingMessageWithASkewedClockAddsNoLine() {
        let rows = rows(
            [
                item(1, sender: anna, ts: day, receivedAt: day + 120 * minute),
                item(nil, sender: me, own: true, ts: day + minute, status: .pending),
            ], calendar: utc)
        XCTAssertEqual(shape(rows), ["time 1", "1 first last", "nil first last"])
    }

    func testTheReadLineSitsUnderTheNewestOwnMessageSomeoneRead() {
        let rows = rows(
            [
                item(1, sender: me, own: true, ts: day, readBy: 2),
                item(2, sender: me, own: true, ts: day, readBy: 1),
                item(3, sender: me, own: true, ts: day),
                item(nil, sender: me, own: true, ts: day),
            ], calendar: utc)
        XCTAssertEqual(shape(rows), ["time 1", "1 first", "2 read 1", "3", "nil last"])
    }

    func testIdsAreUniqueAndStable() {
        let items = [item(1), item(2), item(nil, ts: day + 9)]
        let ids = rows(items, calendar: utc).map(\.id)
        XCTAssertEqual(Set(ids).count, ids.count)
        XCTAssertEqual(ids, rows(items, calendar: utc).map(\.id))
    }

    func testTheMetaLineHoldsNoTime() {
        var pending = item(nil, sender: me, own: true, ts: day, status: .pending)
        XCTAssertEqual(meta(pending, readBy: nil), [.sending])
        pending.edited = true
        XCTAssertEqual(meta(pending, readBy: nil), [.edited, .sending])
        let sent = item(1, sender: me, own: true, ts: day)
        XCTAssertEqual(meta(sent, readBy: 1), [.read])
        XCTAssertEqual(meta(sent, readBy: nil), [])
    }

    func testThePillShowsTheThreeMostUsedEmojiAndTheTotal() {
        let bjarni = person("a3", "Bjarni")
        let reactions = [
            Reaction(emoji: "👍", own: false, people: [anna]),
            Reaction(emoji: "❤️", own: true, people: [anna, me, bjarni]),
            Reaction(emoji: "😂", own: false, people: [anna, bjarni]),
            Reaction(emoji: "😮", own: false, people: [me, bjarni]),
        ]
        XCTAssertEqual(pillEmoji(reactions), ["❤️", "😂", "😮"])
        XCTAssertEqual(reactionCount(reactions), 8)
        XCTAssertEqual(pillEmoji([]), [])
    }

    func testTheSheetListsTheReadersOwnReactionsFirst() {
        let reactions = [
            Reaction(emoji: "👍", own: false, people: [anna]),
            Reaction(emoji: "❤️", own: true, people: [anna, me]),
            Reaction(emoji: "😂", own: true, people: [me]),
        ]
        let rows = reacted(reactions, others: [anna])
        XCTAssertEqual(rows.map(\.person.account), ["a1", "a1", "a2", "a2"])
        XCTAssertEqual(rows.map(\.emoji), ["❤️", "😂", "👍", "❤️"])
        XCTAssertEqual(rows.map(\.own), [true, true, false, false])
        let shared = reacted([Reaction(emoji: "👍", own: true, people: [anna, me])], others: [anna])
        XCTAssertEqual(shared.map(\.person.account), ["a1", "a2"])
        XCTAssertEqual(shared.map(\.own), [true, false])
    }
}
