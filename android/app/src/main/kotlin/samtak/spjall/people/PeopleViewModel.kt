package samtak.spjall.people

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
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
import samtak.spjall.core.ConversationState
import samtak.spjall.core.CoreException
import samtak.spjall.core.Person
import samtak.spjall.socket.Live

/**
 * The new-conversation picker (decisions 0022, 0036): the people met through
 * a shared conversation, then everyone else signed in, a page at a time, and
 * a name search over the whole directory. One person opens the 1:1 there
 * already is with them; more start a group.
 */
class PeopleViewModel(
    private val account: Account,
    private val live: Live,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {
    data class State(
        /** The people met through a shared conversation. */
        val people: List<Person> = emptyList(),
        /** The search as typed. */
        val query: String = "",
        /** The directory's pages so far, for [query]. */
        val directory: List<Person> = emptyList(),
        /** The cursor of the directory's next page, null on the last. */
        val next: String? = null,
        /** A search or a further page is on its way. */
        val searching: Boolean = false,
        val loaded: Boolean = false,
        /** Account ids, in the order they were picked. */
        val picked: List<String> = emptyList(),
        val busy: Boolean = false,
        val problem: Problem? = null,
    ) {
        /** Whom the list shows below [people]: without a search, the people met are not shown twice. */
        val everyone: List<Person>
            get() =
                if (query.isBlank()) {
                    val met = people.mapTo(HashSet()) { it.account }
                    directory.filterNot { it.account in met }
                } else {
                    directory
                }
    }

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    private val _opened = Channel<String>(Channel.BUFFERED)

    /** The conversation to go into. */
    val opened: Flow<String> = _opened.receiveAsFlow()

    private var failed: (() -> Unit)? = null

    private var searchJob: Job? = null

    init {
        load()
    }

    fun toggle(account: String) {
        _state.update { state ->
            state.copy(picked = if (account in state.picked) state.picked - account else state.picked + account)
        }
    }

    fun start() {
        val picked = _state.value.picked
        if (picked.isEmpty()) return
        perform(::start) {
            val id = existing(picked) ?: account.createConversation(picked).also { live.sync() }
            _opened.send(id)
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

    fun more() {
        val state = _state.value
        val next = state.next ?: return
        if (state.searching || searchJob?.isActive == true) return
        searchJob = viewModelScope.launch { page(state.query, after = next) }
    }

    /** A page of the directory for [query]: the first replaces what was shown, a later one adds to it. */
    private suspend fun page(
        query: String,
        after: String?,
    ) {
        _state.update { it.copy(searching = true, problem = null) }
        try {
            val page = withContext(io) { account.directory(query.trim().ifEmpty { null }, after, PAGE) }
            failed = null
            _state.update {
                it.copy(
                    directory = if (after == null) page.people else it.directory + page.people,
                    next = page.next,
                    searching = false,
                )
            }
        } catch (e: CoreException) {
            failed = { search(_state.value.query) }
            _state.update { it.copy(searching = false, problem = e.problem()) }
        }
    }

    fun retry() {
        failed?.invoke()
    }

    private fun load() {
        perform(::load) {
            val people = withContext(io) { account.people() }
            val page = withContext(io) { account.directory(null, null, PAGE) }
            _state.update { it.copy(people = people, directory = page.people, next = page.next, loaded = true) }
        }
    }

    /** The 1:1 with this one person, if there is one to go back to. */
    private fun existing(picked: List<String>): String? =
        picked.singleOrNull()?.let { person ->
            account
                .conversations()
                .firstOrNull { c ->
                    c.state != ConversationState.REMOVED && c.members.map { it.account } == listOf(person)
                }?.id
        }

    private fun perform(
        again: () -> Unit,
        action: suspend () -> Unit,
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

/** How long the search waits for the typing to pause. */
private const val SEARCH_DELAY_MS = 300L

/** A directory page: a screenful and some. */
private const val PAGE = 30u
