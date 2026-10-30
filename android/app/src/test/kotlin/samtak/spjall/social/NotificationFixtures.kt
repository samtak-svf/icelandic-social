package samtak.spjall.social

import samtak.spjall.core.SocialNotification
import samtak.spjall.core.SocialNotificationKind

fun notification(
    id: String,
    kind: SocialNotificationKind,
    createdAt: ULong,
    postId: String? = "p1",
    communityId: String? = "k1",
) = SocialNotification(
    notificationId = id,
    kind = kind,
    actor = anna,
    actors = emptyList(),
    actorCount = 1uL,
    snippet = null,
    announce = false,
    communityId = communityId,
    postId = postId,
    commentId = null,
    action = null,
    emoji = null,
    createdAt = createdAt,
    read = false,
)
