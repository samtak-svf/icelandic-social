import SpjallCore
import XCTest

@testable import Spjall

/// The cases in `api/presentation.vectors.json`, which the web and Android suites read too (#275).
final class PresentationVectorsTests: XCTestCase {
    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Atlantic/Reykjavik")!
        return calendar
    }

    private func vectors() throws -> [String: Any] {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "presentation.vectors", withExtension: "json"))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    }

    private func cases(_ section: String) throws -> [[String: Any]] {
        try XCTUnwrap(vectors()[section] as? [[String: Any]])
    }

    private func instant(_ text: String) throws -> Date {
        try XCTUnwrap(ISO8601DateFormatter().date(from: text), text)
    }

    func testRelativeTimeFollowsEveryVector() throws {
        let all = try cases("relativeTime")
        XCTAssertFalse(all.isEmpty)
        for vector in all {
            let at = try instant(vector["at"] as! String)
            let now = try instant(vector["now"] as! String)
            let age = Dates.age(of: at, now: now)
            let label = "\(vector["at"]!) -> \(vector["now"]!)"
            switch (vector["key"] as? String, vector["count"] as? Int) {
            case ("time_now", nil): XCTAssertEqual(age, .now, label)
            case ("time_minutes", let count?): XCTAssertEqual(age, .minutes(count), label)
            case ("time_hours", let count?): XCTAssertEqual(age, .hours(count), label)
            case ("time_days", let count?): XCTAssertEqual(age, .days(count), label)
            case ("time_weeks", let count?): XCTAssertEqual(age, .weeks(count), label)
            case (nil, nil):
                XCTAssertEqual(age, .date, label)
                XCTAssertEqual(Dates.date(at, calendar: calendar), vector["expected"] as? String, label)
            default: XCTFail("unknown vector \(vector)")
            }
        }
    }

    func testInitialsFollowEveryVector() throws {
        let all = try cases("initials")
        XCTAssertFalse(all.isEmpty)
        for vector in all {
            let name = vector["name"] as? String
            XCTAssertEqual(initials(name), vector["initials"] as? String, "\(String(describing: name))")
        }
    }

    func testARowStampFollowsEveryVector() throws {
        let all = try cases("stamp")
        XCTAssertFalse(all.isEmpty)
        for vector in all {
            let at = try instant(vector["at"] as! String)
            let now = try instant(vector["now"] as! String)
            XCTAssertEqual(
                Dates.stamp(at, now: now, yesterday: "Í gær", calendar: calendar), vector["expected"] as? String,
                "\(vector["at"]!)")
        }
    }

    func testTheListStampTakesItsNowFromTheCaller() throws {
        let all = try cases("listStamp")
        XCTAssertFalse(all.isEmpty)
        for vector in all {
            let at = try instant(vector["at"] as! String)
            let now = try instant(vector["now"] as! String)
            let millis = UInt64(at.timeIntervalSince1970 * 1_000)
            XCTAssertEqual(
                listStamp(millis, now: now, calendar: calendar), vector["expected"] as? String,
                "\(vector["at"]!)")
        }
    }

    func testAProblemIsWordedAsEveryVector() throws {
        let all = try cases("problem")
        XCTAssertFalse(all.isEmpty)
        for vector in all {
            let error: Error
            if vector["outcome"] as? String == "unreachable" {
                error = CoreError.Unreachable(detail: "no answer")
            } else {
                error = CoreError.Refused(
                    status: UInt16(vector["status"] as! Int), code: vector["code"] as? String ?? "", requestId: nil)
            }
            XCTAssertEqual(ProblemCard.messageKey(Problem(error)), vector["key"] as? String, "\(vector)")
        }
    }
}
