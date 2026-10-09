package samtak.spjall.feed

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
import samtak.spjall.account.Account
import samtak.spjall.account.Problem
import samtak.spjall.account.isNotFound
import samtak.spjall.account.problem
import samtak.spjall.core.CoreException
import samtak.spjall.core.Post
import samtak.spjall.core.Reply

/** One post and its replies, oldest first, with a way to add one (decision 0034). */
class RepliesViewModel(
    private val postId: String,
    private val account: Account,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {
    data class State(
        val post: Post? = null,
        val replies: List<Reply> = emptyList(),
        val next: String? = null,
        val loaded: Boolean = false,
        val loadingMore: Boolean = false,
        val sending: Boolean = false,
        /** The post was deleted, or its author blocked: nothing left to show. */
        val gone: Boolean = false,
        val me: String? = null,
        val problem: Problem? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    private val _sent = Channel<Unit>(Channel.BUFFERED)

    /** A reply went up: the field empties. */
    val sent: Flow<Unit> = _sent.receiveAsFlow()

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            try {
                val (post, page, me) =
                    withContext(io) { Triple(account.post(postId), account.replies(postId, null, PAGE), account.me()) }
                _state.update {
                    it.copy(
                        post = post,
                        replies = page.replies,
                        next = page.next,
                        me = me.accountId,
                        loaded = true,
                        problem = null,
                    )
                }
            } catch (e: CoreException) {
                gone(e)
            }
        }
    }

    fun loadMore() {
        val next = _state.value.next ?: return
        if (_state.value.loadingMore) return
        _state.update { it.copy(loadingMore = true) }
        viewModelScope.launch {
            try {
                val page = withContext(io) { account.replies(postId, next, PAGE) }
                _state.update { state ->
                    val shown = state.replies.map { it.replyId }.toSet()
                    state.copy(
                        replies = state.replies + page.replies.filter { it.replyId !in shown },
                        next = page.next,
                        loadingMore = false,
                    )
                }
            } catch (e: CoreException) {
                _state.update { it.copy(loadingMore = false, problem = e.problem()) }
            }
        }
    }

    /** Adds [body], trimmed, at the end; nothing happens when it is blank or too long. */
    fun send(body: String) {
        val text = postable(body) ?: return
        if (_state.value.sending) return
        _state.update { it.copy(sending = true, problem = null) }
        viewModelScope.launch {
            try {
                val reply = withContext(io) { account.createReply(postId, text) }
                _state.update { state ->
                    state.copy(
                        replies = state.replies + reply,
                        post = state.post?.let { it.copy(replyCount = it.replyCount + 1u) },
                        sending = false,
                    )
                }
                _sent.send(Unit)
            } catch (e: CoreException) {
                _state.update { it.copy(sending = false) }
                gone(e)
            }
        }
    }

    fun delete(replyId: String) {
        viewModelScope.launch {
            try {
                withContext(io) { account.deleteReply(replyId) }
                _state.update { state ->
                    state.copy(
                        replies = state.replies.filter { it.replyId != replyId },
                        post =
                            state.post?.let {
                                it.copy(
                                    replyCount =
                                        if (it.replyCount >
                                            0u
                                        ) {
                                            it.replyCount - 1u
                                        } else {
                                            0u
                                        },
                                )
                            },
                    )
                }
            } catch (e: CoreException) {
                _state.update { it.copy(problem = e.problem()) }
            }
        }
    }

    /** Deletes the post itself, which ends the screen. */
    fun deletePost() {
        viewModelScope.launch {
            try {
                withContext(io) { account.deletePost(postId) }
                _state.update { it.copy(gone = true) }
            } catch (e: CoreException) {
                _state.update { it.copy(problem = e.problem()) }
            }
        }
    }

    /** The heart on the post, as on the feed. */
    fun toggleHeart() {
        val post = _state.value.post ?: return
        val toggled = post.toggledHeart()
        _state.update { it.copy(post = toggled) }
        viewModelScope.launch {
            try {
                withContext(io) { account.reactToPost(postId, toggled.myReaction) }
            } catch (e: CoreException) {
                _state.update { it.copy(post = post, problem = e.problem()) }
            }
        }
    }

    private fun gone(e: CoreException) {
        if (e.isNotFound()) {
            _state.update { it.copy(loaded = true, gone = true) }
        } else {
            _state.update { it.copy(loaded = true, problem = e.problem()) }
        }
    }

    private companion object {
        const val PAGE = 50u
    }
}
