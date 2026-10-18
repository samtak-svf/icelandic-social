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
        val mine: List<Community> = emptyList(),
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
                failed = null
                _state.update {
                    it.copy(
                        mine = mine,
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

    /** The end of the list came into view: the search's next page. */
    fun more() {
        val state = _state.value
        val next = state.next ?: return
        if (state.searching || searchJob?.isActive == true) return
        searchJob = viewModelScope.launch { page(state.query, after = next) }
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

/** The longest search the server takes. */
private const val QUERY_LIMIT = 80
