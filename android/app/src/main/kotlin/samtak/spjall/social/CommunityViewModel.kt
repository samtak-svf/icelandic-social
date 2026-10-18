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
import samtak.spjall.core.Post
import samtak.spjall.core.ReactionKind
import samtak.spjall.core.ReportReason
import samtak.spjall.core.ReportTarget

/**
 * One community (decision 0063): its name and audience, joining or leaving it, writing a post while a member
 * who is not muted, and its posts, newest first, each with its reactions and a way into its comments. Its owner
 * and moderators reach its report queue from here. One function per thing [CommunityActions] offers.
 */
@Suppress("TooManyFunctions")
class CommunityViewModel(
    private val id: String,
    private val social: Social,
    private val now: () -> Long = System::currentTimeMillis,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {
    data class State(
        val community: Community? = null,
        /** Newest first. */
        val posts: List<Post> = emptyList(),
        /** The cursor of the next, older page, null on the last. */
        val next: String? = null,
        val loaded: Boolean = false,
        /** Joining, leaving or the first load is on its way. */
        val busy: Boolean = false,
        val loadingMore: Boolean = false,
        /** The post being written. */
        val draft: String = "",
        val publishing: Boolean = false,
        /** The posts whose reaction is on its way. */
        val reacting: Set<String> = emptySet(),
        /** The posts and comments this account reported from here. */
        val reported: Set<String> = emptySet(),
        /** Whether this account may write a post: a member, not muted, in a community that still has an owner. */
        val writes: Boolean = false,
        /** A moderator muted this account here. */
        val muted: Boolean = false,
        val problem: Problem? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    private var failed: (() -> Unit)? = null

    init {
        load()
    }

    /** The community and its first page of posts, asked again each time the screen shows. */
    fun load() {
        perform(::load) {
            reload()
            _state.update { it.copy(loaded = true) }
        }
    }

    /** Joins an open community at once, or asks a private one's moderators; then the community as it is now. */
    fun join() {
        perform(::join) {
            social.joinCommunity(id)
            reload()
        }
    }

    fun leave() {
        perform(::leave) {
            social.leaveCommunity(id)
            reload()
        }
    }

    fun draft(text: String) {
        if (text.length <= POST_LIMIT) _state.update { it.copy(draft = text) }
    }

    /** Posts the draft; it goes to the top of the list and the box empties. */
    fun publish() {
        val state = _state.value
        val body = state.draft.trim()
        if (body.isEmpty() || state.publishing || !state.writes) return
        _state.update { it.copy(publishing = true, problem = null) }
        viewModelScope.launch {
            try {
                val post = withContext(io) { social.createPost(id, body) }
                failed = null
                _state.update { it.copy(posts = listOf(post) + it.posts, draft = "", publishing = false) }
            } catch (e: CoreException) {
                failed = ::publish
                _state.update { it.copy(publishing = false, problem = e.problem()) }
            }
        }
    }

    /** Presses [kind] on the post: it becomes this account's reaction, or pressed again is taken back. */
    fun react(
        postId: String,
        kind: ReactionKind,
    ) {
        val post = _state.value.posts.firstOrNull { it.postId == postId } ?: return
        if (postId in _state.value.reacting) return
        _state.update { it.copy(reacting = it.reacting + postId, problem = null) }
        viewModelScope.launch {
            try {
                val changed = withContext(io) { social.toggle(post, kind) }
                _state.update { s ->
                    s.copy(
                        posts =
                            s.posts.map {
                                if (it.postId ==
                                    postId
                                ) {
                                    changed
                                } else {
                                    it
                                }
                            },
                        reacting = s.reacting - postId,
                    )
                }
            } catch (e: CoreException) {
                _state.update { it.copy(reacting = it.reacting - postId, problem = e.problem()) }
            }
        }
    }

    /** Reports a post to the community's moderators; once sent, the post shows that it was. */
    fun report(
        target: ReportTarget,
        reason: ReportReason,
        note: String,
    ) {
        viewModelScope.launch {
            try {
                withContext(io) { social.report(target, reason, note.trim()) }
                _state.update { it.copy(reported = it.reported + target.id) }
            } catch (e: CoreException) {
                _state.update { it.copy(problem = e.problem()) }
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
                val page = withContext(io) { social.communityPosts(id, next, PAGE) }
                _state.update { it.copy(posts = it.posts + page.posts, next = page.next, loadingMore = false) }
            } catch (e: CoreException) {
                failed = ::more
                _state.update { it.copy(loadingMore = false, problem = e.problem()) }
            }
        }
    }

    fun retry() {
        failed?.invoke()
    }

    private fun reload() {
        val community = social.community(id)
        val page = if (community.reads) social.communityPosts(id, null, PAGE) else null
        _state.update {
            it.copy(
                community = community,
                posts = page?.posts.orEmpty(),
                next = page?.next,
                writes = community.writes(now()),
                muted = community.muted(now()),
            )
        }
    }

    private fun perform(
        again: () -> Unit,
        action: () -> Unit,
    ) {
        if (_state.value.busy) return
        _state.update { it.copy(busy = true, problem = null) }
        viewModelScope.launch {
            try {
                withContext(io) { action() }
                failed = null
                _state.update { it.copy(busy = false) }
            } catch (e: CoreException) {
                failed = again
                _state.update { it.copy(busy = false, loaded = true, problem = e.problem()) }
            }
        }
    }
}

/** A page of posts. */
private const val PAGE = 20u
