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
import samtak.spjall.account.Problem
import samtak.spjall.account.problem
import samtak.spjall.core.Author
import samtak.spjall.core.CoreException
import samtak.spjall.core.Friend
import samtak.spjall.core.FriendRequest
import samtak.spjall.core.FriendSort
import samtak.spjall.core.Snooze

/**
 * This account's own lists (decision 0114): its friends, by newest or by name and narrowed by a search, the requests
 * in and out, and the people it snoozed. The three lists are asked for again after each action, as the web does.
 * The people it may know are read on their own (0114): a read that fails shows nothing and never an error.
 */
@Suppress("TooManyFunctions")
class FriendsViewModel(
    private val social: Social,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {
    data class State(
        val sort: FriendSort = FriendSort.NEWEST,
        /** What the search field holds; [query] is what the list was asked with, a moment later. */
        val typed: String = "",
        val query: String = "",
        val count: ULong = 0uL,
        val friends: List<Friend> = emptyList(),
        val incoming: List<FriendRequest> = emptyList(),
        val sent: List<FriendRequest> = emptyList(),
        val snoozes: List<Snooze> = emptyList(),
        /** The people this account may know, none while it is out of suggestions or the read failed. */
        val suggestions: List<Author> = emptyList(),
        /** Where the next page of suggestions starts, none on the last page. */
        val suggestionsNext: String? = null,
        val loaded: Boolean = false,
        val busy: Boolean = false,
        val problem: Problem? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    private var failed: (() -> Unit)? = null
    private var typing: Job? = null
    private var loadingSuggestions = false

    /** Who was asked from the suggestions, so a later page does not bring them back. */
    private val asked = mutableSetOf<String>()

    init {
        load()
        loadSuggestions()
    }

    fun load() {
        perform(::load) {}
    }

    /** The search field changed: the list follows when typing pauses, so each key does not ask the core. */
    fun onQuery(text: String) {
        _state.update { it.copy(typed = text) }
        typing?.cancel()
        typing =
            viewModelScope.launch {
                delay(DEBOUNCE_MS)
                _state.update { it.copy(query = text.trim()) }
                load()
            }
    }

    fun sortBy(sort: FriendSort) {
        if (sort == _state.value.sort) return
        _state.update { it.copy(sort = sort) }
        load()
    }

    fun accept(accountId: String): Unit = perform({ accept(accountId) }) { social.acceptFriendRequest(accountId) }

    fun decline(accountId: String): Unit = perform({ decline(accountId) }) { social.declineFriendRequest(accountId) }

    fun cancel(accountId: String): Unit = perform({ cancel(accountId) }) { social.cancelFriendRequest(accountId) }

    fun unsnooze(accountId: String): Unit = perform({ unsnooze(accountId) }) { social.unsnoozePerson(accountId) }

    /** Asks a suggested person; on success they leave the section at once, on failure they stay. */
    fun ask(accountId: String): Unit =
        perform({ ask(accountId) }, onDone = { asked += accountId }) { social.sendFriendRequest(accountId) }

    /** Whether this account is in suggestions, then the first page; any failure leaves the section empty. */
    private fun loadSuggestions() {
        loadingSuggestions = true
        viewModelScope.launch {
            try {
                val page =
                    withContext(io) {
                        social.friendSuggestionsIncluded().takeIf { it }?.let {
                            social.friendSuggestions(null, SUGGESTION_PAGE)
                        }
                    }
                if (page != null) {
                    _state.update { it.copy(suggestions = shown(page.people), suggestionsNext = page.next) }
                }
            } catch (_: CoreException) {
                // The section reads on its own: nothing shows and the lists stay as they are.
            }
            loadingSuggestions = false
        }
    }

    /** The end of the suggestions came into view: the page [State.suggestionsNext] points at. */
    fun moreSuggestions() {
        val next = _state.value.suggestionsNext ?: return
        if (loadingSuggestions) return
        loadingSuggestions = true
        viewModelScope.launch {
            try {
                val page = withContext(io) { social.friendSuggestions(next, SUGGESTION_PAGE) }
                _state.update {
                    it.copy(suggestions = it.suggestions + shown(page.people), suggestionsNext = page.next)
                }
            } catch (_: CoreException) {
                // Nothing more shows; the people already shown stay.
            }
            loadingSuggestions = false
        }
    }

    private fun shown(people: List<Author>) = people.filter { it.accountId !in asked }

    fun retry() {
        failed?.invoke()
    }

    /** Runs [action], if any, then asks for the three lists again. */
    private fun perform(
        again: () -> Unit,
        onDone: () -> Unit = {},
        action: () -> Unit,
    ) {
        _state.update { it.copy(busy = true, problem = null) }
        val asked = _state.value
        viewModelScope.launch {
            try {
                val lists =
                    withContext(io) {
                        action()
                        Triple(
                            social.friends(asked.sort, asked.query.ifEmpty { null }),
                            social.friendRequests(),
                            social.snoozes(),
                        )
                    }
                val (page, requests, snoozes) = lists
                failed = null
                onDone()
                _state.update {
                    it.copy(
                        suggestions = shown(it.suggestions),
                        count = page.count,
                        friends = page.friends,
                        incoming = requests.incoming,
                        sent = requests.sent,
                        snoozes = snoozes,
                        loaded = true,
                        busy = false,
                    )
                }
            } catch (e: CoreException) {
                failed = again
                _state.update { it.copy(busy = false, loaded = true, problem = e.problem()) }
            }
        }
    }

    private companion object {
        const val DEBOUNCE_MS = 250L
        const val SUGGESTION_PAGE = 20u
    }
}
