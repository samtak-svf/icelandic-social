import Foundation
import SpjallCore

/// The name the server gave (decision 0022), or a word for none.
func shownName(_ person: Person) -> String {
    person.name ?? localized("person_unnamed")
}

/// A group has no name in v1: it is titled by its members (decision 0022).
func title(_ conversation: Conversation) -> String {
    names(conversation.members)
}

func names(_ people: [Person]) -> String {
    people.map(shownName).joined(separator: ", ")
}

/// Up to two letters: the first of the first and of the last name.
func initials(_ name: String?) -> String {
    let words = name?.split(separator: " ") ?? []
    guard let first = words.first?.first else { return "?" }
    let last = words.count > 1 ? words.last?.first : nil
    return [first, last].compactMap { $0 }.map { String($0).uppercased() }.joined()
}

/// An item as one line of the list.
func lastLine(_ item: Item) -> String {
    switch item.content {
    case .text(let text, _):
        text
    case .media(let mime, _, let caption):
        caption ?? localized(mime.hasPrefix("image/") ? "photo" : "file")
    case .deleted:
        localized("message_deleted")
    case .members(let added, let removed, let devices):
        if !added.isEmpty {
            localized("member_added_card", names(added))
        } else if !removed.isEmpty {
            localized("member_removed_card", names(removed))
        } else {
            localized("new_device_card", names(devices))
        }
    case .timer(let seconds):
        if let seconds {
            localized("disappearing_set_card", shownName(item.sender), duration(seconds))
        } else {
            localized("disappearing_off_card", shownName(item.sender))
        }
    }
}

/// A disappearing timer: whole days when it is, else hours (decision 0022).
func duration(_ seconds: UInt32) -> String {
    let hour: UInt32 = 3_600
    let day: UInt32 = 86_400
    if seconds % day == 0 { return plural("duration_days", Int(seconds / day)) }
    return plural("duration_hours", Int(max(1, seconds / hour)))
}

/// The time today, "yesterday", or the date.
func shortTime(_ millis: UInt64) -> String {
    let date = Date(timeIntervalSince1970: TimeInterval(millis) / 1_000)
    let calendar = Calendar.current
    if calendar.isDateInToday(date) { return date.formatted(date: .omitted, time: .shortened) }
    if calendar.isDateInYesterday(date) { return localized("day_yesterday") }
    return date.formatted(date: .numeric, time: .omitted)
}
