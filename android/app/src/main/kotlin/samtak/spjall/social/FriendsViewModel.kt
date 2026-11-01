package samtak.spjall.social

import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import samtak.spjall.account.Problem
import samtak.spjall.base.BaseViewModel
import samtak.spjall.base.ScreenState
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
) : BaseViewModel<FriendsViewModel.State>(State(), io) {
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
        override val busy: Boolean = false,
        override val problem: Problem? = null,
    ) : ScreenState<State> {
        override fun busy(on: Boolean): State = copy(busy = on)

        override fun trouble(problem: Problem?): State = copy(problem = problem)

        override fun answered(): State = copy(loaded = true)
    }

    private var typing: Job? = null
    private var loadingSuggestions = false

    /** Who was asked from the suggestions, so a later page does not bring them back. */
    private val asked = mutableSetOf<String>()

    init {
        load()
        loadSuggestions()
    }

    fun load() {
        perform(::load) { lists() }
    }

    /** The search field changed: the list follows when typing pauses, so each key does not ask the core. */
    fun onQuery(text: String) {
        edit { it.copy(typed = text) }
        typing?.cancel()
        typing =
            viewModelScope.launch {
                delay(DEBOUNCE_MS)
                edit { it.copy(query = text.trim()) }
                load()
            }
    }

    fun sortBy(sort: FriendSort) {
        if (sort == current.sort) return
        edit { it.copy(sort = sort) }
        load()
    }

    fun accept(accountId: String): Unit =
        perform({ accept(accountId) }) { lists { social.acceptFriendRequest(accountId) } }

    fun decline(accountId: String): Unit =
        perform({ decline(accountId) }) { lists { social.declineFriendRequest(accountId) } }

    fun cancel(accountId: String): Unit =
        perform({ cancel(accountId) }) { lists { social.cancelFriendRequest(accountId) } }

    fun unsnooze(accountId: String): Unit =
        perform({ unsnooze(accountId) }) { lists { social.unsnoozePerson(accountId) } }

    /** Asks a suggested person; on success they leave the section at once, on failure they stay. */
    fun ask(accountId: String): Unit =
        perform({ ask(accountId) }) {
            lists(then = { asked += accountId }) { social.sendFriendRequest(accountId) }
        }

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
                    edit { it.copy(suggestions = shown(page.people), suggestionsNext = page.next) }
                }
            } catch (_: CoreException) {
                // The section reads on its own: nothing shows and the lists stay as they are.
            }
            loadingSuggestions = false
        }
    }

    /** The end of the suggestions came into view: the page [State.suggestionsNext] points at. */
    fun moreSuggestions() {
        val next = current.suggestionsNext ?: return
        if (loadingSuggestions) return
        loadingSuggestions = true
        viewModelScope.launch {
            try {
                val page = withContext(io) { social.friendSuggestions(next, SUGGESTION_PAGE) }
                edit {
                    it.copy(suggestions = it.suggestions + shown(page.people), suggestionsNext = page.next)
                }
            } catch (_: CoreException) {
                // Nothing more shows; the people already shown stay.
            }
            loadingSuggestions = false
        }
    }

    private fun shown(people: List<Author>) = people.filter { it.accountId !in asked }

    /**
     * Runs [action], if any, then asks for the three lists again. [then] runs after the read and before the state
     * is written, so a row the action settled leaves the screen in the same write.
     */
    private suspend fun lists(
        then: () -> Unit = {},
        action: suspend () -> Unit = {},
    ) {
        val now = current
        val (page, requests, snoozes) =
            withContext(io) {
                action()
                Triple(
                    social.friends(now.sort, now.query.ifEmpty { null }),
                    social.friendRequests(),
                    social.snoozes(),
                )
            }
        then()
        edit {
            it.copy(
                suggestions = shown(it.suggestions),
                count = page.count,
                friends = page.friends,
                incoming = requests.incoming,
                sent = requests.sent,
                snoozes = snoozes,
                loaded = true,
            )
        }
    }

    private companion object {
        const val DEBOUNCE_MS = 250L
        const val SUGGESTION_PAGE = 20u
    }
}
