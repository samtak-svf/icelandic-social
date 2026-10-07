package samtak.spjall.conversations

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
import samtak.spjall.core.Conversation
import samtak.spjall.core.CoreException
import samtak.spjall.core.Event
import samtak.spjall.socket.Connection
import samtak.spjall.socket.Live

/**
 * The conversation list (decision 0022): the core's summaries, read again
 * whenever an event may have changed one, and the socket's connection line.
 * An invite link opened while signed in opens its 1:1 from here.
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
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    private val _opened = Channel<String>(Channel.BUFFERED)

    /** Conversation ids to navigate into. */
    val opened: Flow<String> = _opened.receiveAsFlow()

    // A burst of events reads the list once.
    private val reads = Channel<Unit>(Channel.CONFLATED)

    init {
        viewModelScope.launch { for (read in reads) read() }
        viewModelScope.launch { live.connection.collect { c -> _state.update { it.copy(connection = c) } } }
        viewModelScope.launch { live.events.collect { if (it !is Event.Typing) load() } }
        load()
    }

    fun load() {
        reads.trySend(Unit)
    }

    /** An invite link, opened while signed in: into the 1:1 with whoever made it. */
    fun openInvite(token: String) {
        _state.update { it.copy(inviteExpired = false) }
        viewModelScope.launch {
            try {
                val id = withContext(io) { account.openInvite(token) }
                live.sync()
                load()
                _opened.send(id)
            } catch (e: CoreException) {
                when {
                    e.isNotFound() -> _state.update { it.copy(inviteExpired = true) }
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
        } catch (e: CoreException) {
            _state.update { it.copy(loaded = true, problem = e.problem()) }
        }
    }
}
