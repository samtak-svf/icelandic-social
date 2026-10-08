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

    /// The line where a new day starts in a conversation: `todayWord`,
    /// `yesterdayWord`, the weekday within the week ("mánudagur"), else the
    /// date ("30. ágúst").
    static func day(
        _ date: Date, today: Date, todayWord: String, yesterdayWord: String, calendar: Calendar = .current
    ) -> String {
        let ago = days(from: date, to: today, calendar)
        if ago == 0 { return todayWord }
        if ago == 1 { return yesterdayWord }
        if ago > 0 && ago < week { return format("EEEE", date, calendar) }
        if sameYear(date, today, calendar) { return format("d. MMMM", date, calendar) }
        return format("d. MMMM yyyy", date, calendar)
    }

    /// A calendar date with its year: "2. okt. 2026".
    static func date(_ at: Date, calendar: Calendar = .current) -> String {
        format("d. MMM yyyy", at, calendar)
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
func listStamp(_ millis: UInt64) -> String {
    Dates.stamp(Dates.at(millis), now: Date(), yesterday: localized("day_yesterday"))
}

/// The clock time of `millis`.
func clockTime(_ millis: UInt64) -> String {
    Dates.time(Dates.at(millis))
}

/// The date of `millis`, with its year.
func calendarDate(_ millis: UInt64) -> String {
    Dates.date(Dates.at(millis))
}

/// The heading of a day in a conversation.
func dayHeading(_ date: Date) -> String {
    Dates.day(date, today: Date(), todayWord: localized("day_today"), yesterdayWord: localized("day_yesterday"))
}
