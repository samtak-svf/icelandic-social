import SpjallCore

/// What a moderation log entry records (decision 0079). The log has no words of its own, so it borrows the past
/// tense a closed report's decision uses; nil for a later server's action, or a platform moderator's on an account or a wall: `statementLabel` words those.
/// A suspension says its end when it was given one (`until`), and that a moderator lifts it when it was not (0115).
func logActionLabel(_ action: ModerationLogAction, until: UInt64? = nil) -> String? {
    switch action {
    case .hidePost: localized("moderation_decision_hide_post")
    case .removePost: localized("moderation_decision_remove_post")
    case .restorePost: localized("moderation_decision_restore_post")
    case .hideComment: localized("moderation_decision_hide_comment")
    case .removeComment: localized("moderation_decision_remove_comment")
    case .restoreComment: localized("moderation_decision_restore_comment")
    case .muteMember: localized("moderation_decision_mute_member")
    case .unmuteMember: localized("moderation_decision_unmute_member")
    case .removeMember: localized("moderation_decision_remove_member")
    case .banMember: localized("moderation_decision_ban_member")
    case .unbanMember: localized("moderation_decision_unban_member")
    case .closeReport: localized("moderation_decision_dismissed")
    case .deleteCommunity: localized("moderation_decision_community_deleted")
    case .restoreCommunity: localized("moderation_restore")
    case .setCommunityPicture: localized("moderation_log_community_picture_set")
    case .removeCommunityPicture: localized("moderation_log_community_picture_removed")
    case .setCommunityCover: localized("moderation_log_community_cover_set")
    case .removeCommunityCover: localized("moderation_log_community_cover_removed")
    case .pinPost: localized("moderation_log_post_pinned")
    case .unpinPost: localized("moderation_log_post_unpinned")
    case .closePoll: localized("moderation_log_poll_closed")
    case .anonymousPostsOn: localized("moderation_log_anonymous_on")
    case .anonymousPostsOff: localized("moderation_log_anonymous_off")
    case .revealAuthor: localized("moderation_log_author_revealed")
    case .reviewUpheld: localized("moderation_log_review_upheld")
    case .reviewOverturned: localized("moderation_log_review_overturned")
    case .suspendAccount: suspensionLabel(until)
    case .unsuspendAccount: localized("moderation_decision_unsuspend_account")
    case .clearAccountPhoto, .clearAccountBio, .clearAccountCover, .readReported, .unknown: nil
    }
}

/// What a decision to suspend an account says: until the end it was given, or until a moderator lifts it.
func suspensionLabel(_ until: UInt64?) -> String {
    guard let until else { return localized("moderation_decision_suspend_account_open") }
    return localized("moderation_decision_suspend_account_until", Dates.dateTime(Dates.at(until)))
}
