package samtak.spjall.social

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import samtak.spjall.account.Account
import samtak.spjall.account.Problem
import samtak.spjall.account.problem
import samtak.spjall.core.Community
import samtak.spjall.core.CoreException
import samtak.spjall.core.Post
import samtak.spjall.core.ReactionKind
import samtak.spjall.core.ReportReason
import samtak.spjall.core.ReportTarget
import samtak.spjall.core.ReportTargetKind

enum class CommunitiesTab {
    FEED,
    MINE,
    DISCOVER,
}

/**
 * The communities tab (decision 0063): the ones this account is in, then finding one by name, every community
 * it may see while the search is empty. Only a verified account is offered creating one, as on the web.
 */
class CommunitiesViewModel(
    private val social: Social,
    private val account: Account,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {
    data class State(
        val tab: CommunitiesTab = CommunitiesTab.MINE,
        val mine: List<Community> = emptyList(),
        val feed: List<Post> = emptyList(),
        val feedNext: String? = null,
        val reacting: Set<String> = emptySet(),
        val reported: Set<String> = emptySet(),
        /** The search as typed. */
        val query: String = "",
        /** What the search found so far, every community it may see for an empty one. */
        val found: List<Community> = emptyList(),
        /** The cursor of the next page of [found], null on the last. */
        val next: String? = null,
        val searching: Boolean = false,
        /** Whether this account may create a community: a verified one only. */
        val verified: Boolean = false,
        val loaded: Boolean = false,
        val busy: Boolean = false,
        val problem: Problem? = null,
    ) {
        /** What the search shows: without a search, the ones already in [mine] are not shown twice. */
        val others: List<Community>
            get() =
                if (query.isBlank()) {
                    val ids = mine.mapTo(HashSet()) { it.communityId }
                    found.filterNot { it.communityId in ids }
                } else {
                    found
                }
    }

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    private var failed: (() -> Unit)? = null
    private var searchJob: Job? = null

    init {
        load()
    }

    /** The communities this account is in, and the first page of the search, asked again each time the tab shows. */
    fun load() {
        if (_state.value.busy) return
        _state.update { it.copy(busy = true, problem = null) }
        viewModelScope.launch {
            try {
                val verified = withContext(io) { account.me().verified }
                val mine = withContext(io) { social.myCommunities() }
                val page = withContext(io) { social.communities(query(_state.value.query), null, PAGE) }
                val feed = withContext(io) { social.feed(null, FEED_PAGE) }
                failed = null
                _state.update {
                    it.copy(
                        mine = mine,
                        feed = feed.posts,
                        feedNext = feed.next,
                        found = page.communities,
                        next = page.next,
                        verified = verified,
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

    fun search(text: String) {
        _state.update { it.copy(query = text) }
        searchJob?.cancel()
        searchJob =
            viewModelScope.launch {
                delay(SEARCH_DELAY_MS)
                page(text, after = null)
            }
    }

    fun selectTab(tab: CommunitiesTab) {
        _state.update { it.copy(tab = tab) }
    }

    fun react(
        postId: String,
        kind: ReactionKind,
    ) {
        val post = _state.value.feed.firstOrNull { it.postId == postId } ?: return
        if (postId in _state.value.reacting) return
        _state.update { it.copy(reacting = it.reacting + postId) }
        viewModelScope.launch {
            try {
                val changed = withContext(io) { social.toggle(post, kind) }
                _state.update { s ->
                    s.copy(
                        feed = s.feed.map { if (it.postId == postId) changed else it },
                        reacting = s.reacting - postId,
                    )
                }
            } catch (e: CoreException) {
                _state.update { it.copy(reacting = it.reacting - postId, problem = e.problem()) }
            }
        }
    }

    fun report(
        postId: String,
        reason: ReportReason,
        note: String,
    ) {
        viewModelScope.launch {
            try {
                withContext(io) {
                    social.report(ReportTarget(ReportTargetKind.POST, postId), reason, note.trim())
                }
                _state.update { it.copy(reported = it.reported + postId) }
            } catch (e: CoreException) {
                _state.update { it.copy(problem = e.problem()) }
            }
        }
    }

    /** The end of the list came into view: the search's next page. */
    fun more() {
        val state = _state.value
        val next = state.next ?: return
        if (state.searching || searchJob?.isActive == true) return
        searchJob = viewModelScope.launch { page(state.query, after = next) }
    }

    /** The end of the feed came into view: the next, older page. */
    fun moreFeed() {
        val state = _state.value
        val before = state.feedNext ?: return
        if (state.searching || searchJob?.isActive == true) return
        _state.update { it.copy(searching = true) }
        viewModelScope.launch {
            try {
                val page = withContext(io) { social.feed(before, FEED_PAGE) }
                _state.update { it.copy(feed = it.feed + page.posts, feedNext = page.next, searching = false) }
            } catch (e: CoreException) {
                failed = { moreFeed() }
                _state.update { it.copy(searching = false, problem = e.problem()) }
            }
        }
    }

    fun retry() {
        failed?.invoke()
    }

    private suspend fun page(
        text: String,
        after: String?,
    ) {
        _state.update { it.copy(searching = true, problem = null) }
        try {
            val page = withContext(io) { social.communities(query(text), after, PAGE) }
            failed = null
            _state.update {
                it.copy(
                    found = if (after == null) page.communities else it.found + page.communities,
                    next = page.next,
                    searching = false,
                )
            }
        } catch (e: CoreException) {
            failed = { search(_state.value.query) }
            _state.update { it.copy(searching = false, problem = e.problem()) }
        }
    }

    private fun query(text: String) = text.trim().take(QUERY_LIMIT).ifEmpty { null }
}

/** How long the search waits for the typing to pause. */
private const val SEARCH_DELAY_MS = 300L

/** A page of communities: a screenful and some. */
private const val PAGE = 30u

/** A page of posts in the combined feed. */
private const val FEED_PAGE = 20u

/** The longest search the server takes. */
private const val QUERY_LIMIT = 80
