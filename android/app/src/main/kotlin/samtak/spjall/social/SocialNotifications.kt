package samtak.spjall.social

import samtak.spjall.core.CoreClient
import samtak.spjall.core.ModerationStatementPage
import samtak.spjall.core.NotificationKindLevel
import samtak.spjall.core.NotificationLevel
import samtak.spjall.core.NotificationSettings
import samtak.spjall.core.SocialNotificationPage

/** The notification calls of [Social] (decisions 0067, 0103 to 0106), apart so each file stays under the cap. */
interface SocialNotifications {
    /** A page of this account's notifications, newest first, with how many are unread. */
    fun notifications(
        before: String?,
        limit: UInt,
    ): SocialNotificationPage

    /** Every notification made at or before [upTo], the newest shown, is read. */
    fun readNotifications(upTo: ULong)

    /** The list was looked at up to [upTo], the newest shown: it clears the badge and reads no row (0104). */
    fun seenNotifications(upTo: ULong)

    /** One notification is read, or unread again. */
    fun readNotification(
        notificationId: String,
        read: Boolean,
    )

    /** Removes one notification from the list. */
    fun deleteNotification(notificationId: String)

    /** The level of each kind and of each community that has one (0106). */
    fun notificationSettings(): NotificationSettings

    /** A page of what moderators did to this account's content and why, newest first (0115). */
    fun moderationStatements(
        before: String?,
        limit: UInt,
    ): ModerationStatementPage

    /** Asks for the one review of a decision about this account's content. */
    fun askModerationReview(entryId: ULong)

    /** Sets the level of the given kinds and leaves the others. */
    fun setNotificationSettings(kinds: List<NotificationKindLevel>)

    /** Sets how loudly this account is told of one community. */
    fun setCommunityNotificationLevel(
        communityId: String,
        level: NotificationLevel,
    )
}

/** [SocialNotifications] over the core's client. */
class CoreNotifications(
    private val lazyClient: Lazy<CoreClient>,
) : SocialNotifications {
    private val client by lazyClient

    override fun notifications(
        before: String?,
        limit: UInt,
    ) = client.notifications(before, limit)

    override fun readNotifications(upTo: ULong) = client.readNotifications(upTo)

    override fun seenNotifications(upTo: ULong) = client.seenNotifications(upTo)

    override fun readNotification(
        notificationId: String,
        read: Boolean,
    ) = client.readNotification(notificationId, read)

    override fun deleteNotification(notificationId: String) = client.deleteNotification(notificationId)

    override fun moderationStatements(
        before: String?,
        limit: UInt,
    ) = client.moderationStatements(before, limit)

    override fun askModerationReview(entryId: ULong) = client.askModerationReview(entryId)

    override fun notificationSettings() = client.notificationSettings()

    override fun setNotificationSettings(kinds: List<NotificationKindLevel>) = client.setNotificationSettings(kinds)

    override fun setCommunityNotificationLevel(
        communityId: String,
        level: NotificationLevel,
    ) = client.setCommunityNotificationLevel(communityId, level)
}
