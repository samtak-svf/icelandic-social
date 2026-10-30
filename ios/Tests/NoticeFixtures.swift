import Foundation
import SpjallCore

@testable import Spjall

func makeNotice(
    _ id: String, _ kind: SocialNotificationKind, actor: Author? = nil, community: String? = "k1",
    post: String? = nil, emoji: String? = nil, read: Bool = false, createdAt: UInt64 = FakeAccount.now,
    snippet: String? = nil, announce: Bool = false
) -> SocialNotification {
    SocialNotification(
        notificationId: id, kind: kind, actor: actor, actors: actor.map { [$0] } ?? [],
        actorCount: actor == nil ? 0 : 1, snippet: snippet, announce: announce,
        communityId: community, postId: post, commentId: nil,
        action: nil, emoji: emoji, createdAt: createdAt, read: read)
}
