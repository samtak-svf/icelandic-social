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

    private func day(_ date: Date) -> String {
        Dates.day(date, today: at(10, 8, 0, 0), todayWord: "Í dag", yesterdayWord: "Í gær", calendar: calendar)
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

    func testADayHeadingNamesTodayYesterdayTheWeekdayOrTheDate() {
        XCTAssertEqual(day(at(10, 8, 0, 0)), "Í dag")
        XCTAssertEqual(day(at(10, 7, 0, 0)), "Í gær")
        XCTAssertEqual(day(at(10, 5, 0, 0)), "mánudagur")
        XCTAssertEqual(day(at(8, 30, 0, 0)), "30. ágúst")
        XCTAssertEqual(day(at(12, 30, 0, 0, year: 2025)), "30. desember 2025")
    }

    func testADeviceDateCarriesItsYear() {
        XCTAssertEqual(Dates.date(at(10, 2), calendar: calendar), "2. okt. 2026")
        XCTAssertEqual(Dates.date(at(5, 5), calendar: calendar), "5. maí 2026")
    }

    func testMillisAreAnInstant() {
        XCTAssertEqual(Dates.at(1_791_419_400_000), at(10, 8, 0, 30))
    }
}
