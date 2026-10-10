import SpjallCore

/// The words an announcement needs that the core does not give.
struct NoticeLabels: Sendable {
    /// A member with no name.
    let unnamed: String
    /// The title of a conversation with no one else in it.
    let alone: String
    /// A photo or a file with no caption.
    let photo: String
    let file: String
    /// A shared Fljótið post: fixed, never its text or author (decision 0040).
    let post: String
}

/// One conversation's new items, as one notification (decision 0025).
struct Announcement: Equatable, Sendable {
    let conversation: String
    let title: String
    /// One line per item, oldest first; in a group each line names its sender.
    let body: String
}

/// The core's notices as announcements, one per conversation, in the order each
/// conversation first appears. The title is the conversation's members, as
/// the list shows it.
func announcements(_ shown: [Notice], labels: NoticeLabels) -> [Announcement] {
    var order: [String] = []
    var notices: [String: [Notice]] = [:]
    for notice in shown {
        if notices[notice.conversation] == nil { order.append(notice.conversation) }
        notices[notice.conversation, default: []].append(notice)
    }
    return order.compactMap { conversation in
        guard let items = notices[conversation]?.sorted(by: { $0.seq < $1.seq }), let last = items.last else {
            return nil
        }
        let group = last.members.count > 1
        let title =
            last.members.isEmpty
            ? labels.alone
            : last.members.map { $0.name ?? labels.unnamed }.joined(separator: ", ")
        let lines = items.map { notice in
            let text = line(notice, labels: labels)
            return group ? "\(notice.sender.name ?? labels.unnamed): \(text)" : text
        }
        return Announcement(conversation: conversation, title: title, body: lines.joined(separator: "\n"))
    }
}

private func line(_ notice: Notice, labels: NoticeLabels) -> String {
    switch notice.kind {
    case .text: notice.text ?? ""
    case .photo: notice.text ?? labels.photo
    case .file: notice.text ?? labels.file
    case .post: labels.post
    }
}
