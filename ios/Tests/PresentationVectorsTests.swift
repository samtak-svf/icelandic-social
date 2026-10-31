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

    func testANoticeReadsAsEveryVector() throws {
        let all = try cases("notice")
        XCTAssertFalse(all.isEmpty)
        var checked = 0
        for vector in all {
            let kind: SocialNotificationKind =
                switch vector["kind"] as! String {
                case "comment": .comment
                case "reply": .reply
                case "reaction": .reaction
                case "join_approved": .joinApproved
                case "friend_request": .friendRequest
                case "friend_accepted": .friendAccepted
                case "moderated": .moderated
                default: preconditionFailure("unknown kind in \(vector)")
                }
            let names = (vector["actors"] as! [Any]).map { $0 as? String }
            let action: NotificationAction? =
                switch vector["action"] as? String {
                case "decline_anonymous_post": .declineAnonymousPost
                case "hide_post": .hidePost
                case "review_upheld": .reviewUpheld
                case "review_overturned": .reviewOverturned
                case "clear_account_photo": .clearAccountPhoto
                case "clear_account_bio": .clearAccountBio
                case "clear_account_cover": .clearAccountCover
                case "suspend_account": .suspendAccount
                case "unsuspend_account": .unsuspendAccount
                default: nil
                }
            let wording = noticeWording(
                kind: kind, names: names, actorCount: UInt64(vector["actorCount"] as! Int), action: action)
            let args = vector["args"] as! [String: Any]
            let expected: NoticeArgs =
                switch (args.keys.contains("count"), args.keys.contains("other"), args.keys.contains("name")) {
                case (true, _, _): .many(name: args["name"] as? String, count: args["count"] as! Int)
                case (_, true, _): .two(name: args["name"] as? String, other: args["other"] as? String)
                case (_, _, true): .one(name: args["name"] as? String)
                default: .none
                }
            XCTAssertEqual(wording.key, vector["key"] as? String, "\(vector)")
            XCTAssertEqual(wording.args, expected, "\(vector)")
            XCTAssertEqual(wording.badge.rawValue, vector["badge"] as? String, "\(vector)")
            checked += 1
        }
        XCTAssertEqual(checked, all.count)
    }

    func testTheSentenceFillsItsArguments() {
        XCTAssertEqual(
            noticeWording(kind: .comment, names: ["Anna"], actorCount: 1).sentence,
            "Anna skrifaði athugasemd við póstinn þinn.")
        XCTAssertEqual(
            noticeWording(kind: .reply, names: ["Anna", "Bjarni"], actorCount: 2).sentence,
            "Anna og Bjarni svöruðu athugasemdinni þinni.")
        XCTAssertEqual(
            noticeWording(kind: .reaction, names: ["Anna", "B", "C"], actorCount: 3).sentence,
            "Anna og 2 aðrir brugðust við póstinum þínum.")
        XCTAssertEqual(
            noticeWording(kind: .comment, names: [nil], actorCount: 1).sentence,
            localized("notice_comment", localized("person_deleted")))
        XCTAssertEqual(
            noticeWording(kind: .joinApproved, names: [], actorCount: 0).sentence, localized("notice_join_approved"))
    }
}
