package samtak.spjall.conversations

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
import samtak.spjall.account.isNotFound
import samtak.spjall.account.problem
import samtak.spjall.core.Conversation
import samtak.spjall.core.CoreException
import samtak.spjall.core.Event
import samtak.spjall.core.Person
import samtak.spjall.socket.Connection
import samtak.spjall.socket.Live

/**
 * The conversation list (decision 0022): the core's summaries, read again
 * whenever an event may have changed one, and the socket's connection line.
 * An invite link opened while signed in opens its 1:1 from here. A search
 * finds conversations by the start of a name (decision 0038), on this
 * device, then people in the directory (decision 0036) without anyone whose
 * 1:1 is already among them, once the typing pauses as it does in the
 * new-conversation picker.
 */
class ConversationsViewModel(
    private val account: Account,
    private val live: Live,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {
    data class State(
        val conversations: List<Conversation> = emptyList(),
        /** False until the first read, so the empty state does not flash. */
        val loaded: Boolean = false,
        val connection: Connection = Connection.Connecting,
        val problem: Problem? = null,
        /** The invite link last opened is dead; shown until another is opened. */
        val inviteExpired: Boolean = false,
        /** The search as typed. */
        val query: String = "",
        /** What [query] found: conversations first, then people from the directory. */
        val found: Found? = null,
        /** A search is on its way. */
        val searching: Boolean = false,
    ) {
        /** A search shows its results in place of the list. */
        val searched: Boolean get() = query.isNotBlank()

        /** The search is done and found neither a conversation nor a person. */
        val nothingFound: Boolean
            get() = searched && !searching && found?.let { it.conversations.isEmpty() && it.people.isEmpty() } == true
    }

    data class Found(
        val query: String,
        val conversations: List<Conversation>,
        val people: List<Person>,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    private val _opened = Channel<String>(Channel.BUFFERED)

    /** Conversation ids to navigate into. */
    val opened: Flow<String> = _opened.receiveAsFlow()

    // A burst of events reads the list once.
    private val reads = Channel<Unit>(Channel.CONFLATED)

    private var searchJob: Job? = null

    init {
        viewModelScope.launch { for (read in reads) read() }
        viewModelScope.launch { live.connection.collect { c -> _state.update { it.copy(connection = c) } } }
        viewModelScope.launch { live.events.collect { if (it !is Event.Typing) load() } }
        load()
    }

    fun load() {
        reads.trySend(Unit)
    }

    /** Reads the list again, and searches again when a search is shown. */
    fun retry() {
        load()
        _state.value.query
            .takeIf { it.isNotBlank() }
            ?.let(::search)
    }

    fun search(text: String) {
        val blank = text.isBlank()
        _state.update { it.copy(query = text, found = if (blank) null else it.found, searching = !blank) }
        searchJob?.cancel()
        if (blank) return
        searchJob =
            viewModelScope.launch {
                delay(SEARCH_DELAY_MS)
                find(text.trim())
            }
    }

    /** Into the 1:1 with someone the search found, made when there is none. */
    fun openPerson(person: String) {
        viewModelScope.launch {
            try {
                val id = withContext(io) { account.openDirect(person) }
                live.sync()
                load()
                _opened.send(id)
            } catch (e: CoreException) {
                _state.update { it.copy(problem = e.problem()) }
            }
        }
    }

    private suspend fun find(query: String) {
        _state.update { it.copy(searching = true, problem = null) }
        try {
            // One call: the core leaves out of the people anyone whose 1:1 is among the conversations (0038).
            val found = withContext(io) { account.searchList(query, PAGE) }
            _state.update { it.copy(found = Found(query, found.conversations, found.people), searching = false) }
        } catch (e: CoreException) {
            _state.update { it.copy(searching = false, problem = e.problem()) }
        }
    }

    /**
     * An invite link, opened while signed in: into the 1:1 with whoever made it.
     * The link that just let the person in may be used up, as the operator's
     * is: then it is no dead link to tell of.
     */
    fun openInvite(
        token: String,
        signedUp: Boolean = false,
    ) {
        _state.update { it.copy(inviteExpired = false) }
        viewModelScope.launch {
            try {
                val id = withContext(io) { account.openInvite(token) }
                live.sync()
                load()
                _opened.send(id)
            } catch (e: CoreException) {
                when {
                    e.isNotFound() -> _state.update { it.copy(inviteExpired = !signedUp) }
                    // The operator's link, or this account's own: no 1:1 to open.
                    e is CoreException.Invalid -> Unit
                    else -> _state.update { it.copy(problem = e.problem()) }
                }
            }
        }
    }

    private suspend fun read() {
        try {
            val conversations = withContext(io) { account.conversations() }
            _state.update { it.copy(conversations = conversations, loaded = true, problem = null) }
            // The conversations a search found change with the list; the people it found do not.
            val found = _state.value.found ?: return
            val again = withContext(io) { account.searchConversations(found.query) }
            _state.update {
                it.copy(
                    found =
                        it.found
                            ?.takeIf { f ->
                                f.query == found.query
                            }?.copy(conversations = again),
                )
            }
        } catch (e: CoreException) {
            _state.update { it.copy(loaded = true, problem = e.problem()) }
        }
    }
}

/** How long the search waits for the typing to pause, as the new-conversation picker does. */
private const val SEARCH_DELAY_MS = 300L

/** The people a search shows: a screenful and some. */
private const val PAGE = 30u
