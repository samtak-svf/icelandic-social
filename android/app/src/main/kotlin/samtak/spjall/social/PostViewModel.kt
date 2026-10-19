package samtak.spjall.social

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import samtak.spjall.account.Problem
import samtak.spjall.account.problem
import samtak.spjall.core.Comment
import samtak.spjall.core.CoreException
import samtak.spjall.core.Post
import samtak.spjall.core.ReactionKind
import samtak.spjall.core.ReportReason
import samtak.spjall.core.ReportTarget

/**
 * One post and its comments, oldest first, with the box to add one (decision 0063); the post and each comment
 * can be reported, and this account's own deleted. One function per thing [PostActions] offers.
 */
@Suppress("TooManyFunctions")
class PostViewModel(
    private val id: String,
    private val social: Social,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {
    data class State(
        val post: Post? = null,
        /** Oldest first. */
        val comments: List<Comment> = emptyList(),
        /** The cursor of the next, newer page, null on the last. */
        val next: String? = null,
        val loaded: Boolean = false,
        val busy: Boolean = false,
        val loadingMore: Boolean = false,
        /** The comment being written. */
        val draft: String = "",
        val sending: Boolean = false,
        val reacting: Boolean = false,
        /** The post and comments this account reported from here. */
        val reported: Set<String> = emptySet(),
        /** This account's id: its own post and comments can be deleted. */
        val me: String? = null,
        val problem: Problem? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    private val _deleted = Channel<String>(Channel.BUFFERED)

    /** The post was deleted: back to its community, by id. */
    val deleted: Flow<String> = _deleted.receiveAsFlow()

    private var failed: (() -> Unit)? = null

    init {
        load()
    }

    fun load() {
        if (_state.value.busy) return
        _state.update { it.copy(busy = true, problem = null) }
        viewModelScope.launch {
            try {
                val post = withContext(io) { social.post(id) }
                val page = withContext(io) { social.comments(id, null, PAGE) }
                val me = _state.value.me ?: withContext(io) { social.me() }
                failed = null
                _state.update {
                    it.copy(
                        post = post,
                        comments = page.comments,
                        next = page.next,
                        me = me,
                        loaded = true,
                        busy = false,
                    )
                }
            } catch (e: CoreException) {
                failed = ::load
                _state.update { it.copy(busy = false, loaded = true, problem = e.problem()) }
            }
        }
    }

    fun draft(text: String) {
        if (text.length <= COMMENT_LIMIT) _state.update { it.copy(draft = text) }
    }

    /**
     * Sends the draft. The comment is shown at the end once every page is there, and the post counts it; with
     * pages still to come it is reached by scrolling to them.
     */
    fun send() {
        val state = _state.value
        val body = state.draft.trim()
        if (body.isEmpty() || state.sending) return
        _state.update { it.copy(sending = true, problem = null) }
        viewModelScope.launch {
            try {
                val comment = withContext(io) { social.createComment(id, body) }
                failed = null
                _state.update {
                    it.copy(
                        comments = if (it.next == null) it.comments + comment else it.comments,
                        post = it.post?.let { post -> post.copy(commentCount = post.commentCount + 1uL) },
                        draft = "",
                        sending = false,
                    )
                }
            } catch (e: CoreException) {
                failed = ::send
                _state.update { it.copy(sending = false, problem = e.problem()) }
            }
        }
    }

    fun react(kind: ReactionKind) {
        val state = _state.value
        val post = state.post ?: return
        if (state.reacting) return
        _state.update { it.copy(reacting = true, problem = null) }
        viewModelScope.launch {
            try {
                val changed = withContext(io) { social.toggle(post, kind) }
                _state.update { it.copy(post = changed, reacting = false) }
            } catch (e: CoreException) {
                _state.update { it.copy(reacting = false, problem = e.problem()) }
            }
        }
    }

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

    /** Deletes this account's own post; [deleted] then takes the screen back to its community. */
    fun deletePost() {
        val post = _state.value.post ?: return
        if (_state.value.busy) return
        _state.update { it.copy(busy = true, problem = null) }
        viewModelScope.launch {
            try {
                withContext(io) { social.deletePost(post.postId) }
                _state.update { it.copy(busy = false) }
                _deleted.send(post.communityId)
            } catch (e: CoreException) {
                _state.update { it.copy(busy = false, problem = e.problem()) }
            }
        }
    }

    /** Deletes this account's own comment; it leaves the list, and the post counts one fewer. */
    fun deleteComment(commentId: String) {
        viewModelScope.launch {
            try {
                withContext(io) { social.deleteComment(commentId) }
                _state.update { s ->
                    val left = s.comments.filterNot { it.commentId == commentId }
                    val gone = left.size < s.comments.size
                    s.copy(
                        comments = left,
                        post =
                            s.post?.let { post ->
                                if (gone &&
                                    post.commentCount > 0uL
                                ) {
                                    post.copy(commentCount = post.commentCount - 1uL)
                                } else {
                                    post
                                }
                            },
                    )
                }
            } catch (e: CoreException) {
                _state.update { it.copy(problem = e.problem()) }
            }
        }
    }

    /** The end of the comments came into view: the next, newer page. */
    fun more() {
        val state = _state.value
        val next = state.next ?: return
        if (state.loadingMore || state.busy) return
        _state.update { it.copy(loadingMore = true) }
        viewModelScope.launch {
            try {
                val page = withContext(io) { social.comments(id, next, PAGE) }
                _state.update { it.copy(comments = it.comments + page.comments, next = page.next, loadingMore = false) }
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

/** A page of comments. */
private const val PAGE = 50u
