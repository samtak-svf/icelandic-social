package samtak.spjall.social

import samtak.spjall.core.SocialNotification

/** What [NotificationsScreen] can ask for. */
interface NotificationsActions {
    /** A tap: the row is read, then into the post, or its community (see [opens]). */
    fun open(notification: SocialNotification)

    fun more()

    fun retry()

    /** Header action: everything shown is read. */
    fun markAllRead()

    /** The row menu (0105). */
    fun setRead(
        notification: SocialNotification,
        read: Boolean,
    )

    fun remove(notification: SocialNotification)

    fun kindInApp(notification: SocialNotification)

    fun communityOff(notification: SocialNotification)
}
