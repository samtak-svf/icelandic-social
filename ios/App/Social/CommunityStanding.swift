import SpjallCore

/// Whether this account may post, comment and react in `community`: a member, in a community that is not
/// read-only, and not muted there (0063).
func canWrite(_ community: Community, now: UInt64) -> Bool {
    community.role != nil && !community.readOnly && !isMuted(community, now: now)
}

/// The string key telling a member why there is no composer, or nil when there is one or this account has not joined.
func noPostNoticeKey(_ community: Community, now: UInt64) -> String? {
    guard community.role != nil else { return nil }
    if community.readOnly { return "community_read_only" }
    return isMuted(community, now: now) ? "community_muted" : nil
}

/// A moderator muted this account in `community`, and the mute has not ended.
func isMuted(_ community: Community, now: UInt64) -> Bool {
    community.role != nil && (community.mutedUntil.map { $0 > now } ?? false)
}
