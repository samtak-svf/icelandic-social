import Foundation
import SpjallCore

/// One line of the timeline as the screen draws it.
enum Row: Identifiable, Equatable {
    /// A centred time line (decision 0045): the time of the item it comes
    /// before, which names the row.
    case time(Date, before: Item)
    /// A system card: members or the disappearing timer changed.
    case card(Item)
    /// `first` starts a run from one sender, which names the sender in a group;
    /// `last` ends it; `readBy` is set under the newest own message someone has read.
    case bubble(Item, first: Bool, last: Bool, readBy: UInt32?)

    var id: String {
        switch self {
        case .time(_, let before): "time-\(key(before))"
        case .card(let item), .bubble(let item, _, _, _): key(item)
        }
    }
}

/// The timeline's rows, oldest first: a time line before the first item, and
/// before each item whose day differs from the previous item's or whose time is
/// an hour or more from it (decision 0045); messages from one sender within 5
/// minutes of each other run together (decision 0022), the first and the last
/// of a run marked.
func rows(_ items: [Item], calendar: Calendar = .current) -> [Row] {
    let run: UInt64 = 300_000
    let read = items.last { $0.own && $0.seq != nil && $0.readBy > 0 }
    var rows: [Row] = []
    // The item before, of any kind; and the bubble a run would continue.
    var before: Item?
    var previous: Item?
    for item in items {
        // The timeline is in arrival order, so a message sent yesterday can arrive among
        // today's. Its day differs from the item before it, so it gets a line with its own
        // day and time, and the next item, back on today, gets one too.
        if before.map({ needsLine(item, after: $0, calendar) }) ?? true {
            rows.append(.time(instant(item.ts), before: item))
            previous = nil
        }
        before = item
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

/// A time line goes before `item` when its local day differs from `previous`'s,
/// or its time is an hour or more from it, before or after.
private func needsLine(_ item: Item, after previous: Item, _ calendar: Calendar) -> Bool {
    let hour: UInt64 = 3_600_000
    let gap = item.ts >= previous.ts ? item.ts - previous.ts : previous.ts - item.ts
    return gap >= hour || !calendar.isDate(instant(item.ts), inSameDayAs: instant(previous.ts))
}

private func instant(_ millis: UInt64) -> Date {
    Date(timeIntervalSince1970: TimeInterval(millis) / 1_000)
}

/// What the small line under a bubble shows, in order.
enum MetaPart: Equatable {
    case edited, sending, read
}

/// The line under a bubble: the edited marker, then a clock while sending
/// (decision 0043), then who read it. Never a time: the time lines carry it,
/// and a tap shows a bubble's own (decision 0045).
func meta(_ item: Item, readBy: UInt32?) -> [MetaPart] {
    var parts: [MetaPart] = []
    if item.edited { parts.append(.edited) }
    if item.status == .pending { parts.append(.sending) }
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
