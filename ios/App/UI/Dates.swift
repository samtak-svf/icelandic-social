import Foundation

/// Every date and time the app shows, in Icelandic whatever the device's
/// language: a 24-hour clock, "í gær", short weekdays and day-first dates.
/// The words for today and yesterday are brand strings and come in as
/// arguments, so this stays plain Swift and unit-testable.
enum Dates {
    static let icelandic = Locale(identifier: "is")

    /// "09:38".
    static func time(_ at: Date, calendar: Calendar = .current) -> String {
        format("HH:mm", at, calendar)
    }

    /// A conversation row's stamp: the time today, `yesterday`, the weekday
    /// within the week ("mán"), the day and month this year ("30. ágú"),
    /// else with the year too.
    static func stamp(_ at: Date, now: Date, yesterday: String, calendar: Calendar = .current) -> String {
        let ago = days(from: at, to: now, calendar)
        if ago <= 0 { return time(at, calendar: calendar) }
        if ago == 1 { return yesterday.lowercased(with: icelandic) }
        if ago < week { return bare(format("EEE", at, calendar)) }
        if sameYear(at, now, calendar) { return bare(format("d. MMM", at, calendar)) }
        return format("d. MMM yyyy", at, calendar)
    }

    /// A time line between messages (decision 0045): the time today ("15:16"),
    /// `yesterdayWord` and the time ("Í gær 23:01"), the weekday within the week
    /// ("mánudagur 09:12"), else the date ("30. ágúst 14:00"), with the year
    /// when it is not this one.
    static func line(_ at: Date, now: Date, yesterdayWord: String, calendar: Calendar = .current) -> String {
        let ago = days(from: at, to: now, calendar)
        if ago == 0 { return time(at, calendar: calendar) }
        if ago == 1 { return "\(yesterdayWord) \(time(at, calendar: calendar))" }
        if ago > 0 && ago < week { return format("EEEE HH:mm", at, calendar) }
        if sameYear(at, now, calendar) { return format("d. MMMM HH:mm", at, calendar) }
        return format("d. MMMM yyyy HH:mm", at, calendar)
    }

    /// A calendar date with its year: "2. okt. 2026".
    static func date(_ at: Date, calendar: Calendar = .current) -> String {
        format("d. MMM yyyy", at, calendar)
    }

    /// A year and month as the server sends them ("2026-03"), in words: "mars 2026". Nil when the text is not one.
    static func month(_ yearMonth: String, calendar: Calendar = .current) -> String? {
        let parts = yearMonth.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 2, (1...12).contains(parts[1]),
            let date = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: 1))
        else { return nil }
        return format("LLLL yyyy", date, calendar)
    }

    /// A moment to the minute with its year: "15. jan. 2027, 00:00".
    static func dateTime(_ at: Date, calendar: Calendar = .current) -> String {
        format("d. MMM yyyy, HH:mm", at, calendar)
    }

    /// How long before `now` a moment was, in whole units rounded down: `date` once it is over four weeks old. A
    /// clock a little ahead of the server's never reads as the future (decision 0080).
    enum Age: Equatable, Sendable {
        case now
        case minutes(Int)
        case hours(Int)
        case days(Int)
        case weeks(Int)
        case date
    }

    static func age(of at: Date, now: Date) -> Age {
        let seconds = max(0, Int(now.timeIntervalSince(at)))
        if seconds < 60 { return .now }
        if seconds < 3_600 { return .minutes(seconds / 60) }
        if seconds < 86_400 { return .hours(seconds / 3_600) }
        if seconds < 7 * 86_400 { return .days(seconds / 86_400) }
        if seconds < 28 * 86_400 { return .weeks(seconds / (7 * 86_400)) }
        return .date
    }

    static func at(_ millis: UInt64) -> Date {
        Date(timeIntervalSince1970: TimeInterval(millis) / 1_000)
    }

    private static let week = 7

    /// Whole calendar days from `date`'s day to `today`'s; negative when `date` is later.
    private static func days(from date: Date, to today: Date, _ calendar: Calendar) -> Int {
        calendar.dateComponents([.day], from: calendar.startOfDay(for: date), to: calendar.startOfDay(for: today)).day
            ?? 0
    }

    private static func sameYear(_ one: Date, _ other: Date, _ calendar: Calendar) -> Bool {
        calendar.component(.year, from: one) == calendar.component(.year, from: other)
    }

    /// A fixed pattern, so neither the device's language nor its 12-hour
    /// setting changes it.
    private static func format(_ pattern: String, _ date: Date, _ calendar: Calendar) -> String {
        let formatter = DateFormatter()
        formatter.locale = icelandic
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = pattern
        return formatter.string(from: date)
    }

    /// CLDR abbreviates with a full stop ("mán.", "ágú."); a list stamp drops it.
    private static func bare(_ text: String) -> String {
        text.hasSuffix(".") ? String(text.dropLast()) : text
    }
}

/// A conversation row's stamp for `millis`.
func listStamp(_ millis: UInt64, now: Date = Date(), calendar: Calendar = .current) -> String {
    Dates.stamp(Dates.at(millis), now: now, yesterday: localized("day_yesterday"), calendar: calendar)
}

/// The clock time of `millis`.
func clockTime(_ millis: UInt64) -> String {
    Dates.time(Dates.at(millis))
}

/// The date of `millis`, with its year.
func calendarDate(_ millis: UInt64) -> String {
    Dates.date(Dates.at(millis))
}

/// A time line between messages in a conversation.
func timeLine(_ date: Date) -> String {
    Dates.line(date, now: Date(), yesterdayWord: localized("day_yesterday"))
}

/// The short age a hub row and a post card carry ("6 klst."), or the date once it is no longer recent (decision 0080).
func relativeTime(_ millis: UInt64, now: Date = Date()) -> String {
    let at = Dates.at(millis)
    switch Dates.age(of: at, now: now) {
    case .now: return localized("time_now")
    case .minutes(let count): return localized("time_minutes", count)
    case .hours(let count): return localized("time_hours", count)
    case .days(let count): return localized("time_days", count)
    case .weeks(let count): return localized("time_weeks", count)
    case .date: return Dates.date(at)
    }
}
