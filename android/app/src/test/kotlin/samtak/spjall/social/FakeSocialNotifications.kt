package samtak.spjall.social

import samtak.spjall.account.unreachable
import samtak.spjall.core.CommunityNotificationLevel
import samtak.spjall.core.CoreException
import samtak.spjall.core.ModerationReview
import samtak.spjall.core.ModerationReviewState
import samtak.spjall.core.ModerationStatement
import samtak.spjall.core.ModerationStatementPage
import samtak.spjall.core.NotificationKindLevel
import samtak.spjall.core.NotificationLevel
import samtak.spjall.core.NotificationSettings
import samtak.spjall.core.SocialNotification
import samtak.spjall.core.SocialNotificationKind
import samtak.spjall.core.SocialNotificationPage

/**
 * The notification half of [FakeSocial], in memory, with the call log and the failure switches it shares:
 * [failNext] makes the next call throw, [failOn] makes every call of that name throw, [calls] records what was
 * asked, in order.
 */
@Suppress("TooManyFunctions")
open class FakeSocialNotifications : SocialNotifications {
    val calls = mutableListOf<String>()
    var failNext: CoreException? = null
    var failOn: String? = null

    /** The size of a page when a call asks for more than this; small, to test paging. */
    var pageSize = Int.MAX_VALUE

    /** Newest first. */
    var notifications = listOf<SocialNotification>()

    /** Up to which time the notifications are read. */
    var readUpTo: ULong = 0uL

    /** Single rows marked read or unread by [readNotification]; they override [readUpTo]. */
    val readRows = mutableMapOf<String, Boolean>()

    /** Up to which time the list was seen; none if never. */
    var seenUpTo: ULong? = null

    /** This account's statements of reasons, newest first (0115). */
    var statements = listOf<ModerationStatement>()

    /** The level of each kind, and of the communities that have one (0106). */
    val kindLevels = SocialNotificationKind.entries.associateWith { NotificationLevel.PUSH }.toMutableMap()
    val communityLevels = mutableMapOf<String, NotificationLevel>()

    override fun moderationStatements(
        before: String?,
        limit: UInt,
    ): ModerationStatementPage {
        call("moderationStatements ${before.orEmpty()}".trim())
        val (items, next) = page(statements, before, limit)
        return ModerationStatementPage(items, next)
    }

    override fun askModerationReview(entryId: ULong) {
        call("askModerationReview $entryId")
        statements =
            statements.map {
                if (it.entryId == entryId) {
                    val review = ModerationReview(ModerationReviewState.OPEN, 2uL, null, null, false)
                    it.copy(canAsk = false, review = review)
                } else {
                    it
                }
            }
    }

    protected fun call(name: String) {
        calls += name
        if (name == failOn) throw unreachable()
        failNext?.let {
            failNext = null
            throw it
        }
    }

    protected fun <T> page(
        items: List<T>,
        after: String?,
        limit: UInt,
    ): Pair<List<T>, String?> {
        val start = after?.toInt() ?: 0
        val size = minOf(limit.toInt(), pageSize)
        val end = minOf(items.size, start + size)
        return items.subList(start, end).toList() to (if (end < items.size) "$end" else null)
    }

    override fun notifications(
        before: String?,
        limit: UInt,
    ): SocialNotificationPage {
        call("notifications ${before.orEmpty()} $limit".replace("  ", " "))
        val shown = notifications.map { it.copy(read = readRows[it.notificationId] ?: (it.createdAt <= readUpTo)) }
        val (items, next) = page(shown, before, limit)
        val unseen = shown.count { !it.read && it.createdAt > (seenUpTo ?: 0uL) }
        return SocialNotificationPage(items, shown.count { !it.read }.toULong(), unseen.toULong(), seenUpTo, next)
    }

    override fun readNotifications(upTo: ULong) {
        call("readNotifications $upTo")
        readUpTo = maxOf(readUpTo, upTo)
        readRows.clear()
    }

    override fun seenNotifications(upTo: ULong) {
        call("seenNotifications $upTo")
        seenUpTo = maxOf(seenUpTo ?: 0uL, upTo)
    }

    override fun readNotification(
        notificationId: String,
        read: Boolean,
    ) {
        call("readNotification $notificationId $read")
        readRows[notificationId] = read
    }

    override fun deleteNotification(notificationId: String) {
        call("deleteNotification $notificationId")
        notifications = notifications.filter { it.notificationId != notificationId }
    }

    override fun notificationSettings(): NotificationSettings {
        call("notificationSettings")
        return NotificationSettings(
            kindLevels.map { (kind, level) -> NotificationKindLevel(kind, level) },
            communityLevels.map { (id, level) -> CommunityNotificationLevel(id, level) },
        )
    }

    override fun setNotificationSettings(kinds: List<NotificationKindLevel>) {
        call("setNotificationSettings " + kinds.joinToString { "${it.kind}=${it.level}" })
        kinds.forEach { kindLevels[it.kind] = it.level }
    }

    override fun setCommunityNotificationLevel(
        communityId: String,
        level: NotificationLevel,
    ) {
        call("setCommunityNotificationLevel $communityId $level")
        communityLevels[communityId] = level
    }
}
