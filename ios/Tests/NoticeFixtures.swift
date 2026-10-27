import Foundation
import SpjallCore

@testable import Spjall

func makeNotice(
    _ id: String, _ kind: SocialNotificationKind, actor: Author? = nil, community: String = "k1",
    post: String? = nil, emoji: String? = nil, read: Bool = false, createdAt: UInt64 = FakeAccount.now
) -> SocialNotification {
    SocialNotification(
        notificationId: id, kind: kind, actor: actor, actors: [], actorCount: 1, snippet: nil, announce: false,
        communityId: community, postId: post, commentId: nil,
        action: nil, emoji: emoji, createdAt: createdAt, read: read)
}
