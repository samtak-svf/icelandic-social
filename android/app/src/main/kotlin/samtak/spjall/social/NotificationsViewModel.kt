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
import samtak.spjall.core.CoreException
import samtak.spjall.core.SocialNotification
import samtak.spjall.core.SocialNotificationKind

/**
 * What was addressed to this account (decision 0067), newest first. Showing the list marks what it shows read,
 * up to the newest, and then tells [read] so the tab's count is asked for again.
 */
class NotificationsViewModel(
    private val social: Social,
    private val read: () -> Unit,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {
    data class State(
        /** Newest first, each with whether it was read before this list showed it. */
        val notifications: List<SocialNotification> = emptyList(),
        val next: String? = null,
        val loaded: Boolean = false,
        val busy: Boolean = false,
        val loadingMore: Boolean = false,
        val problem: Problem? = null,
    )

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
                _state.update {
                    it.copy(notifications = page.notifications, next = page.next, loaded = true, busy = false)
                }
                val newest = page.notifications.firstOrNull()
                if (newest != null && page.unread > 0uL) {
                    withContext(io) { social.readNotifications(newest.createdAt) }
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
}

/** Where a tap on [this] goes: the post, or its community when the post is not there to open. */
sealed interface Opens {
    data class Post(
        val postId: String,
    ) : Opens

    data class Community(
        val communityId: String,
    ) : Opens
}

/** A moderated post may be removed, so a moderation notice opens its community, as on the web. */
fun SocialNotification.opens(): Opens {
    val post = postId
    return if (post != null &&
        kind != SocialNotificationKind.MODERATED
    ) {
        Opens.Post(post)
    } else {
        Opens.Community(communityId)
    }
}

/** A page of notifications. */
private const val PAGE = 30u
