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
    /// A sent location: fixed, never the place (decision 0059).
    let location: String
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
    case .location: labels.location
    }
}

/// One social notification as a lock-screen alert (decision 0107): the sentence the list's row shows, with no
/// snippet, since a lock screen is seen by others. It sits in a thread of its own, named by the notification's id,
/// so reading the row takes it away.
struct SocialAnnouncement: Equatable, Sendable {
    let id: String
    let sentence: String
    /// What a tap opens: the post, or the community when there is no post.
    let post: String?
    let community: String
}

/// The core's social notices as announcements, in their order.
func socialAnnouncements(_ social: [SocialNotice]) -> [SocialAnnouncement] {
    social.map { notice in
        let target = noticeTarget(kind: notice.kind, postId: notice.postId, communityId: notice.communityId)
        return SocialAnnouncement(
            id: notice.notificationId, sentence: noticeWording(notice).sentence, post: target.post,
            community: target.community)
    }
}
