import Foundation
import SpjallCore

/// One line of the timeline as the screen draws it.
enum Row: Identifiable, Equatable {
    /// Where a new day starts: the day's start, and the item it comes before.
    /// A day can start twice when an older message arrives after a newer one,
    /// so the item, not the date, names the row.
    case day(Date, before: Item)
    /// A system card: members or the disappearing timer changed.
    case card(Item)
    /// `first` starts a run from one sender, which names the sender in a group;
    /// `last` ends it, and the time goes under it; `readBy` is set under the
    /// newest own message someone has read.
    case bubble(Item, first: Bool, last: Bool, readBy: UInt32?)

    var id: String {
        switch self {
        case .day(_, let before): "day-\(key(before))"
        case .card(let item), .bubble(let item, _, _, _): key(item)
        }
    }
}

/// The timeline's rows, oldest first: a day line before each new day, and
/// messages from one sender within 5 minutes of each other run together
/// (decision 0022), the first and the last of a run marked.
func rows(_ items: [Item], calendar: Calendar = .current) -> [Row] {
    let run: UInt64 = 300_000
    let read = items.last { $0.own && $0.seq != nil && $0.readBy > 0 }
    var rows: [Row] = []
    var previous: Item?
    var day: Date?
    for item in items {
        let start = calendar.startOfDay(for: Date(timeIntervalSince1970: TimeInterval(item.ts) / 1_000))
        if start != day {
            rows.append(.day(start, before: item))
            day = start
            previous = nil
        }
        if isCard(item) {
            rows.append(.card(item))
            previous = nil
            continue
        }
        // Senders' clocks differ, so an earlier time breaks the run rather than joining it.
        let runs =
            previous.map { $0.sender.account == item.sender.account && item.ts >= $0.ts && item.ts - $0.ts <= run }
            ?? false
        rows.append(.bubble(item, first: !runs, last: true, readBy: item == read ? item.readBy : nil))
        previous = item
    }
    // A bubble that the next one continues is not the end of its run.
    for index in rows.indices.dropLast() {
        if case .bubble(let item, let first, _, let readBy) = rows[index],
            case .bubble(_, false, _, _) = rows[index + 1]
        {
            rows[index] = .bubble(item, first: first, last: false, readBy: readBy)
        }
    }
    return rows
}

/// What the small line under a bubble shows, in order.
enum MetaPart: Equatable {
    case edited, sending, time, read
}

/// The line under a bubble: the edited marker, then a clock while sending
/// (decision 0043) or the time, then who read it. The time shows at the end of
/// a run; the rest always.
func meta(_ item: Item, last: Bool, readBy: UInt32?) -> [MetaPart] {
    var parts: [MetaPart] = []
    if item.edited { parts.append(.edited) }
    if item.status == .pending {
        parts.append(.sending)
    } else if last || readBy != nil {
        parts.append(.time)
    }
    if readBy != nil { parts.append(.read) }
    return parts
}

func isCard(_ item: Item) -> Bool {
    switch item.content {
    case .members, .timer: true
    case .text, .media, .deleted, .post: false
    }
}

private func key(_ item: Item) -> String {
    if let seq = item.seq { return "s\(seq)" }
    if let envelope = item.envelopeId { return "e\(envelope)" }
    return "t\(item.ts)"
}
