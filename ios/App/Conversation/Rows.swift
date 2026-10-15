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
    // The time of the item before, of any kind; and the bubble a run would continue.
    var before: UInt64?
    var previous: (item: Item, at: UInt64)?
    for item in items {
        // The timeline is in the server's order, and so are its times (decision 0048):
        // a row's time never goes back, so no line says an earlier time than the one
        // above it, whatever the sender's clock said.
        let at = max(item.at, before ?? 0)
        if before.map({ needsLine(at, after: $0, calendar) }) ?? true {
            rows.append(.time(instant(at), before: item))
            previous = nil
        }
        before = at
        if isCard(item) {
            rows.append(.card(item))
            previous = nil
            continue
        }
        let runs = previous.map { $0.item.sender.account == item.sender.account && at - $0.at <= run } ?? false
        rows.append(.bubble(item, first: !runs, last: true, readBy: item == read ? item.readBy : nil))
        previous = (item, at)
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

/// A time line goes before a row when its local day differs from the one
/// before, or it is an hour or more later.
private func needsLine(_ at: UInt64, after previous: UInt64, _ calendar: Calendar) -> Bool {
    let hour: UInt64 = 3_600_000
    return at - previous >= hour || !calendar.isDate(instant(at), inSameDayAs: instant(previous))
}

extension Item {
    /// When the server stored it (decision 0048), or the sender's clock for what
    /// the server has not given a time: a row still being sent, or one from before.
    var at: UInt64 { receivedAt ?? ts }
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
    case .text, .media, .deleted, .post, .unreadable: false
    }
}

private func key(_ item: Item) -> String {
    if let seq = item.seq { return "s\(seq)" }
    if let envelope = item.envelopeId { return "e\(envelope)" }
    return "t\(item.ts)"
}
