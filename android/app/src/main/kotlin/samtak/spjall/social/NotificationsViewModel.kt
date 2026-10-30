package samtak.spjall.social

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import samtak.spjall.account.Problem
import samtak.spjall.account.problem
import samtak.spjall.core.Community
import samtak.spjall.core.CoreException
import samtak.spjall.core.NotificationAction
import samtak.spjall.core.NotificationKindLevel
import samtak.spjall.core.NotificationLevel
import samtak.spjall.core.SocialNotification
import samtak.spjall.core.SocialNotificationKind

/**
 * What was addressed to this account (decision 0067), newest first. Showing the list marks what it shows SEEN, up to
 * the newest, never read (0104), and then tells [read] so the tab's count is asked for again. [dismiss] takes the
 * system notification of a row away once the row is read or removed (0107).
 */
class NotificationsViewModel(
    private val social: Social,
    private val read: () -> Unit,
    private val io: CoroutineDispatcher = Dispatchers.IO,
    private val dismiss: (String) -> Unit = {},
) : ViewModel() {
    data class State(
        /** Newest first, each with whether it was read before this list showed it. */
        val notifications: List<SocialNotification> = emptyList(),
        val next: String? = null,
        val loaded: Boolean = false,
        val busy: Boolean = false,
        val loadingMore: Boolean = false,
        val problem: Problem? = null,
        /** When the list was last seen BEFORE this open; none if never, then every row is new. */
        val seenAt: ULong? = null,
        /** The communities this account is in, for a row's name and picture; empty until known. */
        val communities: Map<String, Community> = emptyMap(),
    ) {
        /** The rows made after the list was last seen, then the rest; either may be empty. */
        val sections: Pair<List<SocialNotification>, List<SocialNotification>>
            get() = notifications.partition { n -> seenAt == null || n.createdAt > seenAt }
    }

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    private var failed: (() -> Unit)? = null

    /** The first page, asked for each time the tab shows, then read up to its newest. */
    fun load() {
        if (_state.value.busy) return
        _state.update { it.copy(busy = true, problem = null) }
        viewModelScope.launch {
            try {
                val page = withContext(io) { social.notifications(null, PAGE) }
                failed = null
                val communities = withContext(io) { social.communitiesById() }
                _state.update {
                    it.copy(
                        notifications = page.notifications,
                        next = page.next,
                        loaded = true,
                        busy = false,
                        seenAt = page.seenAt,
                        communities = communities ?: it.communities,
                    )
                }
                val newest = page.notifications.firstOrNull()
                if (newest != null && page.unseen > 0uL) {
                    withContext(io) { social.seenNotifications(newest.createdAt) }
                    read()
                }
            } catch (e: CoreException) {
                failed = ::load
                _state.update { it.copy(busy = false, loaded = true, problem = e.problem()) }
            }
        }
    }

    /** The end of the list came into view: the next, older page. */
    fun more() {
        val state = _state.value
        val next = state.next ?: return
        if (state.loadingMore || state.busy) return
        _state.update { it.copy(loadingMore = true) }
        viewModelScope.launch {
            try {
                val page = withContext(io) { social.notifications(next, PAGE) }
                _state.update {
                    it.copy(
                        notifications = it.notifications + page.notifications,
                        next = page.next,
                        loadingMore = false,
                    )
                }
            } catch (e: CoreException) {
                failed = ::more
                _state.update { it.copy(loadingMore = false, problem = e.problem()) }
            }
        }
    }

    fun retry() {
        failed?.invoke()
    }

    /** A tap on a row: it is read, whatever the screen does next. */
    fun opened(notification: SocialNotification) {
        if (!notification.read) setRead(notification, true) else dismiss(notification.notificationId)
    }

    /** Header action: every row up to the newest is read. */
    fun markAllRead() {
        val newest = _state.value.notifications.firstOrNull() ?: return
        val before = _state.value.notifications
        _state.update { s -> s.copy(notifications = s.notifications.map { it.copy(read = true) }) }
        before.forEach { dismiss(it.notificationId) }
        change(before) { social.readNotifications(newest.createdAt) }
    }

    /** The menu's read / unread. */
    fun setRead(
        notification: SocialNotification,
        read: Boolean,
    ) {
        val before = _state.value.notifications
        replace(before.map { if (it.notificationId == notification.notificationId) it.copy(read = read) else it })
        if (read) dismiss(notification.notificationId)
        change(before) { social.readNotification(notification.notificationId, read) }
    }

    /** The menu's remove. */
    fun remove(notification: SocialNotification) {
        val before = _state.value.notifications
        replace(before.filterNot { it.notificationId == notification.notificationId })
        dismiss(notification.notificationId)
        change(before) { social.deleteNotification(notification.notificationId) }
    }

    /** The menu's "this kind in-app only": a level is only ever lowered, and a kind already off stays off. */
    fun kindInApp(notification: SocialNotification) {
        if (notification.kind == SocialNotificationKind.MODERATED) return
        change(null) {
            val current = social.notificationSettings().kinds.firstOrNull { it.kind == notification.kind }
            if (current?.level != NotificationLevel.OFF) {
                social.setNotificationSettings(
                    listOf(NotificationKindLevel(notification.kind, NotificationLevel.IN_APP)),
                )
            }
        }
    }

    /** The menu's "turn this community off". */
    fun communityOff(notification: SocialNotification) {
        val community = notification.communityId
        if (notification.kind == SocialNotificationKind.MODERATED || community == null) return
        change(null) { social.setCommunityNotificationLevel(community, NotificationLevel.OFF) }
    }

    private fun replace(list: List<SocialNotification>) = _state.update { it.copy(notifications = list) }

    /** Runs [call] off the main thread; on failure puts [rollback] back and shows the problem. */
    private fun change(
        rollback: List<SocialNotification>?,
        call: () -> Unit,
    ) {
        viewModelScope.launch {
            try {
                withContext(io) { call() }
                read()
            } catch (e: CoreException) {
                _state.update { s -> s.copy(notifications = rollback ?: s.notifications, problem = e.problem()) }
            }
        }
    }
}

/** The communities this account is in by id; none when the core cannot say, which only costs the names. */
private fun Social.communitiesById(): Map<String, Community>? =
    try {
        myCommunities().associateBy { it.communityId }
    } catch (_: CoreException) {
        null
    }

/**
 * Where a tap on [this] goes: the statements for what a moderator did with its reasons, the post, else its community
 * when the post is not there to open, else nowhere.
 */
sealed interface Opens {
    data class Post(
        val postId: String,
    ) : Opens

    data class Community(
        val communityId: String,
    ) : Opens

    data object Statements : Opens

    data object Nowhere : Opens
}

/** The moderated rows a statement of reasons explains (0115). */
private val STATED =
    setOf(
        NotificationAction.HIDE_POST,
        NotificationAction.REMOVE_POST,
        NotificationAction.HIDE_COMMENT,
        NotificationAction.REMOVE_COMMENT,
        NotificationAction.CLEAR_ACCOUNT_PHOTO,
        NotificationAction.SUSPEND_ACCOUNT,
        NotificationAction.REVIEW_UPHELD,
        NotificationAction.REVIEW_OVERTURNED,
    )

/** A moderated post may be removed, so a moderation notice opens its reasons or its community, as on the web. */
fun SocialNotification.opens(): Opens {
    val post = postId
    return when {
        kind == SocialNotificationKind.MODERATED && action in STATED -> Opens.Statements
        post != null && kind != SocialNotificationKind.MODERATED -> Opens.Post(post)
        else -> communityId?.let { Opens.Community(it) } ?: Opens.Nowhere
    }
}

/** A page of notifications. */
private const val PAGE = 30u
