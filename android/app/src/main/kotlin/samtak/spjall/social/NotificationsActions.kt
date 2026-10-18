package samtak.spjall.social

import samtak.spjall.core.SocialNotification

/** What [NotificationsScreen] can ask for. */
interface NotificationsActions {
    /** A tap: into the post, or its community (see [opens]). */
    fun open(notification: SocialNotification)

    fun more()

    fun retry()
}
