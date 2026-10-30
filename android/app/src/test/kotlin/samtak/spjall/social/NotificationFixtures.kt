package samtak.spjall.social

import samtak.spjall.core.NotificationAction
import samtak.spjall.core.SocialNotification
import samtak.spjall.core.SocialNotificationKind

fun notification(
    id: String,
    kind: SocialNotificationKind,
    createdAt: ULong,
    postId: String? = "p1",
    communityId: String? = "k1",
    action: NotificationAction? = null,
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
    action = action,
    emoji = null,
    createdAt = createdAt,
    read = false,
)
