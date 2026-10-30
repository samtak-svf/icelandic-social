import Foundation
import SpjallCore

/// The mark on a notification's picture (decision 0103): the reaction's own emoji, a speech bubble, a check or a
/// shield.
enum NoticeBadge: String, Equatable, Sendable {
    case emoji, comment, approved, moderator
}

/// The arguments of a notification's sentence. A nil name is a deleted account.
enum NoticeArgs: Equatable, Sendable {
    case none
    case one(name: String?)
    case two(name: String?, other: String?)
    /// `count` is the others: every actor but the newest.
    case many(name: String?, count: Int)
}

/// Which sentence a notification reads and with what, chosen by the `notice` rule of
/// `api/presentation.vectors.json`, which the web and Android follow too. The list row and the push share it, so a
/// notification and its row say the same thing (decision 0107).
struct NoticeWording: Equatable, Sendable {
    let key: String
    let args: NoticeArgs
    let badge: NoticeBadge
}

/// `names` are the newest actors' names, newest first (nil for a deleted account), `actorCount` every distinct one.
/// A moderated row reads by its `action` (0115), and `notice_moderated` for every action without a sentence of its own.
func noticeWording(
    kind: SocialNotificationKind, names: [String?], actorCount: UInt64, action: NotificationAction? = nil
) -> NoticeWording {
    let base: String
    let badge: NoticeBadge
    switch kind {
    case .comment: (base, badge) = ("notice_comment", .comment)
    case .reply: (base, badge) = ("notice_reply", .comment)
    case .reaction: (base, badge) = ("notice_reaction", .emoji)
    case .joinApproved: return NoticeWording(key: "notice_join_approved", args: .none, badge: .approved)
    case .moderated:
        return NoticeWording(key: moderatedKey(action), args: .none, badge: .moderator)
    }
    let name = names.first ?? nil
    switch actorCount {
    case ...1:
        return NoticeWording(key: base, args: .one(name: name), badge: badge)
    case 2:
        let other = names.count > 1 ? names[1] : nil
        return NoticeWording(key: base + "_two", args: .two(name: name, other: other), badge: badge)
    default:
        return NoticeWording(key: base + "_many", args: .many(name: name, count: Int(actorCount) - 1), badge: badge)
    }
}

private func moderatedKey(_ action: NotificationAction?) -> String {
    switch action {
    case .declineAnonymousPost: "notice_anonymous_declined"
    case .reviewUpheld: "notice_review_upheld"
    case .reviewOverturned: "notice_review_overturned"
    case .clearAccountPhoto: "notice_account_photo_cleared"
    case .suspendAccount: "notice_account_suspended"
    case .unsuspendAccount: "notice_account_unsuspended"
    case .hidePost, .removePost, .restorePost, .hideComment, .removeComment, .restoreComment, .muteMember,
        .unmuteMember, .removeMember, .banMember, .unbanMember, .unknown, nil:
        "notice_moderated"
    }
}

extension NoticeWording {
    /// The sentence in the brand's words. The `_many` keys are a plural on the others' count, which
    /// `localizedStringWithFormat` picks by the catalogue's variation.
    var sentence: String {
        let deleted = String(localized: "person_deleted")
        func text(_ key: String) -> String { String(localized: String.LocalizationValue(key)) }
        switch args {
        case .none: return text(key)
        case .one(let name): return String(format: text(key), name ?? deleted)
        case .two(let name, let other): return String(format: text(key), name ?? deleted, other ?? deleted)
        case .many(let name, let count):
            return String.localizedStringWithFormat(NSLocalizedString(key, comment: ""), name ?? deleted, count)
        }
    }
}

/// An actor's name as a notification says it: the name, or the word for an account with none.
func noticeName(_ author: Author) -> String {
    author.name ?? String(localized: "person_unnamed")
}

/// The sentence of a notification from the core: the row's and, from a `SocialNotice`, the push's.
func noticeWording(_ notification: SocialNotification) -> NoticeWording {
    noticeWording(
        kind: notification.kind, names: notification.actors.map(noticeName), actorCount: notification.actorCount,
        action: notification.action)
}

func noticeWording(_ notice: SocialNotice) -> NoticeWording {
    noticeWording(
        kind: notice.kind, names: notice.actors.map(noticeName), actorCount: notice.actorCount, action: notice.action)
}

/// What a notification opens: its post, or its community when it has no post or the post was moderated away;
/// neither when it has no community (0114). One rule for the list's rows and for a tapped push.
func noticeTarget(
    kind: SocialNotificationKind, postId: String?, communityId: String?
) -> (post: String?, community: String?) {
    (kind == .moderated ? nil : postId, communityId)
}
