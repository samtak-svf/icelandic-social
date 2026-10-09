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
import samtak.spjall.account.problem
import samtak.spjall.core.CoreException
import samtak.spjall.core.Person
import samtak.spjall.core.Post
import samtak.spjall.core.PostPage

/**
 * A list of posts (decision 0034): Fljótið, this account's wall on Ég, or
 * another account's wall, which can open the 1:1 with it. Nothing is pushed
 * live; the screens refresh on opening, on a pull and on coming back.
 */
class PostsViewModel(
    private val source: Source,
    private val account: Account,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {
    sealed interface Source {
        data object Feed : Source

        /** This account's own wall. */
        data object Mine : Source

        data class Wall(
            val account: String,
        ) : Source
    }

    data class State(
        val posts: List<Post> = emptyList(),
        val next: String? = null,
        /** False until the first page, so the empty state does not flash. */
        val loaded: Boolean = false,
        val refreshing: Boolean = false,
        val loadingMore: Boolean = false,
        val posting: Boolean = false,
        /** This account, so its own posts can be deleted. */
        val me: String? = null,
        /** Whose wall it is, for another account's. */
        val person: Person? = null,
        /** This account blocked the wall's: no 1:1 to open. */
        val blocked: Boolean = false,
        val problem: Problem? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    private val _posted = Channel<Unit>(Channel.BUFFERED)

    /** A post went up: the composer closes. */
    val posted: Flow<Unit> = _posted.receiveAsFlow()

    private val _opened = Channel<String>(Channel.BUFFERED)

    /** The 1:1 to navigate into. */
    val opened: Flow<String> = _opened.receiveAsFlow()

    init {
        refresh()
    }

    /** The first page again, in place of what is shown. */
    fun refresh() {
        if (_state.value.refreshing) return
        _state.update { it.copy(refreshing = true) }
        viewModelScope.launch {
            try {
                val page =
                    withContext(io) {
                        val me = _state.value.me ?: account.me().accountId
                        _state.update { it.copy(me = me) }
                        (source as? Source.Wall)?.let { wall ->
                            val person = account.profile(wall.account)
                            val blocked = account.blocked().any { it.account == wall.account }
                            _state.update { it.copy(person = person, blocked = blocked) }
                        }
                        page(null)
                    }
                _state.update { it.fresh(page).copy(loaded = true, refreshing = false, problem = null) }
            } catch (e: CoreException) {
                _state.update { it.copy(loaded = true, refreshing = false, problem = e.problem()) }
            }
        }
    }

    /** The page after the last one shown, when there is one. */
    fun loadMore() {
        val next = _state.value.next ?: return
        if (_state.value.loadingMore || _state.value.refreshing) return
        _state.update { it.copy(loadingMore = true) }
        viewModelScope.launch {
            try {
                val page = withContext(io) { page(next) }
                _state.update { state ->
                    val shown = state.posts.map { it.postId }.toSet()
                    state.copy(
                        posts = state.posts + page.posts.filter { it.postId !in shown },
                        next = page.next,
                        loadingMore = false,
                    )
                }
            } catch (e: CoreException) {
                _state.update { it.copy(loadingMore = false, problem = e.problem()) }
            }
        }
    }

    /** Posts [body], trimmed; nothing happens when it is blank or too long. */
    fun post(body: String) {
        val text = postable(body) ?: return
        if (_state.value.posting) return
        _state.update { it.copy(posting = true, problem = null) }
        viewModelScope.launch {
            try {
                val post = withContext(io) { account.createPost(text) }
                _state.update { it.copy(posts = listOf(post) + it.posts, posting = false) }
                _posted.send(Unit)
            } catch (e: CoreException) {
                _state.update { it.copy(posting = false, problem = e.problem()) }
            }
        }
    }

    fun delete(postId: String) {
        viewModelScope.launch {
            try {
                withContext(io) { account.deletePost(postId) }
                _state.update { state -> state.copy(posts = state.posts.filter { it.postId != postId }) }
            } catch (e: CoreException) {
                _state.update { it.copy(problem = e.problem()) }
            }
        }
    }

    /** The heart, shown at once; put back as it was when the server refuses. */
    fun toggleHeart(post: Post) {
        val toggled = post.toggledHeart()
        replace(toggled)
        viewModelScope.launch {
            try {
                withContext(io) { account.reactToPost(post.postId, toggled.myReaction) }
            } catch (e: CoreException) {
                replace(post)
                _state.update { it.copy(problem = e.problem()) }
            }
        }
    }

    /** Into the 1:1 with the wall's account, made when there is none. */
    fun contact() {
        val wall = source as? Source.Wall ?: return
        viewModelScope.launch {
            try {
                _opened.send(withContext(io) { account.openDirect(wall.account) })
            } catch (e: CoreException) {
                _state.update { it.copy(problem = e.problem()) }
            }
        }
    }

    /**
     * The first page in place of the newest posts. The older pages already
     * read stay below it, so coming back to a list scrolled far down keeps it.
     */
    private fun State.fresh(page: PostPage): State {
        val oldest = page.posts.lastOrNull()
        if (page.next == null || oldest == null) return copy(posts = page.posts, next = page.next)
        val read = page.posts.map { it.postId }.toSet()
        val older = posts.filter { it.createdAt < oldest.createdAt && it.postId !in read }
        return if (older.isEmpty()) copy(posts = page.posts, next = page.next) else copy(posts = page.posts + older)
    }

    private fun replace(post: Post) {
        _state.update { state -> state.copy(posts = state.posts.map { if (it.postId == post.postId) post else it }) }
    }

    private fun page(before: String?): PostPage =
        when (source) {
            Source.Feed -> account.feed(before, PAGE)
            Source.Mine -> account.wall(_state.value.me ?: account.me().accountId, before, PAGE)
            is Source.Wall -> account.wall(source.account, before, PAGE)
        }

    private companion object {
        const val PAGE = 30u
    }
}
