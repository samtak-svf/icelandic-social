import XCTest

@testable import Spjall

final class DatesTests: XCTestCase {
    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Atlantic/Reykjavik")!
        return calendar
    }

    // Thursday 8 October 2026, mid-afternoon.
    private var now: Date { at(10, 8, 14, 51) }

    private func at(_ month: Int, _ day: Int, _ hour: Int = 9, _ minute: Int = 38, year: Int = 2026) -> Date {
        calendar.date(from: DateComponents(year: year, month: month, day: day, hour: hour, minute: minute))!
    }

    private func stamp(_ date: Date) -> String {
        Dates.stamp(date, now: now, yesterday: "Í gær", calendar: calendar)
    }

    private func line(_ date: Date) -> String {
        Dates.line(date, now: now, yesterdayWord: "Í gær", calendar: calendar)
    }

    /// The pattern is fixed, so the device's language and 12-hour setting do not reach it.
    func testTimesAreOnA24HourClock() {
        XCTAssertEqual(Dates.time(at(10, 8), calendar: calendar), "09:38")
        XCTAssertEqual(Dates.time(at(10, 8, 21, 5), calendar: calendar), "21:05")
    }

    func testARowStampIsTheTimeTodayThenYesterdayThenTheWeekdayThenTheDate() {
        XCTAssertEqual(stamp(at(10, 8)), "09:38")
        XCTAssertEqual(stamp(at(10, 7, 23, 59)), "í gær")
        XCTAssertEqual(stamp(at(10, 5)), "mán")
        XCTAssertEqual(stamp(at(10, 2)), "fös")
        XCTAssertEqual(stamp(at(8, 30)), "30. ágú")
        XCTAssertEqual(stamp(at(10, 2, year: 2025)), "2. okt. 2025")
    }

    func testAClockAheadOfOursStillShowsATime() {
        XCTAssertEqual(stamp(at(10, 8, 15, 10)), "15:10")
    }

    func testATimeLineNamesTheTimeThenYesterdayTheWeekdayOrTheDate() {
        XCTAssertEqual(line(at(10, 8, 15, 16)), "15:16")
        XCTAssertEqual(line(at(10, 8, 0, 5)), "00:05")
        XCTAssertEqual(line(at(10, 7, 23, 1)), "Í gær 23:01")
        XCTAssertEqual(line(at(10, 5, 9, 12)), "mánudagur 09:12")
        XCTAssertEqual(line(at(8, 30, 14, 0)), "30. ágúst 14:00")
        XCTAssertEqual(line(at(12, 30, 8, 0, year: 2025)), "30. desember 2025 08:00")
    }

    func testADeviceDateCarriesItsYear() {
        XCTAssertEqual(Dates.date(at(10, 2), calendar: calendar), "2. okt. 2026")
        XCTAssertEqual(Dates.date(at(5, 5), calendar: calendar), "5. maí 2026")
    }

    func testMillisAreAnInstant() {
        XCTAssertEqual(Dates.at(1_791_419_400_000), at(10, 8, 0, 30))
    }

    func testAnAgeIsWholeUnitsRoundedDownThenTheDate() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        func age(_ seconds: Double) -> Dates.Age { Dates.age(of: now.addingTimeInterval(-seconds), now: now) }
        XCTAssertEqual(age(59), .now)
        XCTAssertEqual(age(60), .minutes(1))
        XCTAssertEqual(age(3_599), .minutes(59))
        XCTAssertEqual(age(6 * 3_600 + 5), .hours(6))
        XCTAssertEqual(age(2 * 86_400), .days(2))
        XCTAssertEqual(age(15 * 86_400), .weeks(2))
        XCTAssertEqual(age(28 * 86_400), .date)
    }

    func testAClockAheadOfOursIsNeverTheFuture() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        XCTAssertEqual(Dates.age(of: now.addingTimeInterval(30), now: now), .now)
    }
}
