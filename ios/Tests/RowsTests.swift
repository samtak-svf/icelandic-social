import SpjallCore
import XCTest

@testable import Spjall

final class RowsTests: XCTestCase {
    private let day: UInt64 = 1_700_000_000_000  // 2023-11-14 22:13 UTC
    private let minute: UInt64 = 60_000
    private let anna = person("a2", "Anna")
    private let me = person("a1", "Jón")
    private var utc: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }

    private func shape(_ rows: [Row]) -> [String] {
        let format = Date.ISO8601FormatStyle(timeZone: TimeZone(identifier: "UTC")!).year().month().day()
        return rows.map {
            switch $0 {
            case .day(let date): "day \(date.formatted(format))"
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
        XCTAssertEqual(shape(rows), ["day 2023-11-14", "1 first", "2 last", "3 first last", "4 first last"])
    }

    func testANewDayAndACardBreakARun() {
        let rows = rows(
            [
                item(1, ts: day),
                item(2, ts: day + minute, content: .timer(seconds: 3_600)),
                item(3, ts: day + 2 * minute),
                item(4, ts: day + 120 * minute),
            ], calendar: utc)
        XCTAssertEqual(
            shape(rows),
            ["day 2023-11-14", "1 first last", "card 2", "3 first last", "day 2023-11-15", "4 first last"])
    }

    func testTheReadLineSitsUnderTheNewestOwnMessageSomeoneRead() {
        let rows = rows(
            [
                item(1, sender: me, own: true, ts: day, readBy: 2),
                item(2, sender: me, own: true, ts: day, readBy: 1),
                item(3, sender: me, own: true, ts: day),
                item(nil, sender: me, own: true, ts: day),
            ], calendar: utc)
        XCTAssertEqual(shape(rows), ["day 2023-11-14", "1 first", "2 read 1", "3", "nil last"])
    }

    func testIdsAreUniqueAndStable() {
        let items = [item(1), item(2), item(nil, ts: day + 9)]
        let ids = rows(items, calendar: utc).map(\.id)
        XCTAssertEqual(Set(ids).count, ids.count)
        XCTAssertEqual(ids, rows(items, calendar: utc).map(\.id))
    }
}
