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
import samtak.spjall.account.problem
import samtak.spjall.core.Conversation
import samtak.spjall.core.ConversationState
import samtak.spjall.core.CoreException
import samtak.spjall.socket.Live

/**
 * The conversation picker: the list, to pick one or several conversations from, and what to do in each.
 * A forward (decision 0041) and a shared post (decision 0040) differ only in [deliver], run once per
 * picked conversation, in the list's order. One that fails stops the round; what went stays sent and
 * unpicked, so trying again sends no copy twice. The list can be searched by name (decisions 0038,
 * 0043), and [preview] reads what is being sent, to show above it.
 */
class PickViewModel(
    private val account: Account,
    private val live: Live,
    /** The conversation the pick started from, left out of the list; null to offer them all. */
    private val except: String? = null,
    private val io: CoroutineDispatcher = Dispatchers.IO,
    /** What is being sent, for the preview; null shows none. */
    private val preview: Account.() -> Outgoing? = { null },
    private val deliver: Account.(to: String) -> Unit,
) : ViewModel() {
    data class State(
        val conversations: List<Conversation> = emptyList(),
        /** False until the first read, so the empty state does not flash. */
        val loaded: Boolean = false,
        val picked: Set<String> = emptySet(),
        val sending: Boolean = false,
        val problem: Problem? = null,
        /** The search as typed. */
        val query: String = "",
        /** What the search found, null while there is none; a pick it hides stays picked. */
        val found: List<Conversation>? = null,
        val outgoing: Outgoing? = null,
    ) {
        val canSend: Boolean get() = picked.isNotEmpty() && !sending

        /** The rows: what the search found, or every conversation. */
        val shown: List<Conversation> get() = found ?: conversations
    }

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    private val _done = Channel<Int>(Channel.BUFFERED)

    /** How many conversations were sent into, once all the picked ones were. */
    val done: Flow<Int> = _done.receiveAsFlow()

    /** Sent into by an earlier round that then failed, for the count [done] gives. */
    private var sentBefore = 0

    private var searchJob: Job? = null

    init {
        load()
    }

    fun toggle(conversation: String) {
        if (_state.value.sending) return
        _state.update {
            it.copy(picked = if (conversation in it.picked) it.picked - conversation else it.picked + conversation)
        }
    }

    fun send() {
        val state = _state.value
        if (!state.canSend) return
        val targets = state.conversations.map { it.id }.filter { it in state.picked }
        _state.update { it.copy(sending = true, problem = null) }
        viewModelScope.launch {
            val sent = mutableListOf<String>()
            try {
                withContext(io) {
                    targets.forEach { to ->
                        account.deliver(to)
                        sent += to
                    }
                }
            } catch (e: CoreException) {
                _state.update { it.copy(problem = e.problem()) }
            }
            if (sent.isNotEmpty()) live.sync()
            _state.update { it.copy(picked = it.picked - sent.toSet(), sending = false) }
            sentBefore += sent.size
            if (_state.value.problem == null) _done.send(sentBefore)
        }
    }

    /** By name, as the list's search (decision 0038), once the typing pauses. */
    fun search(text: String) {
        val blank = text.isBlank()
        _state.update { it.copy(query = text, found = if (blank) null else it.found) }
        searchJob?.cancel()
        if (blank) return
        searchJob =
            viewModelScope.launch {
                delay(SEARCH_DELAY_MS)
                try {
                    val found = withContext(io) { account.searchConversations(text.trim()) }
                    _state.update { it.copy(found = found.filter(::offered), problem = null) }
                } catch (e: CoreException) {
                    _state.update { it.copy(problem = e.problem()) }
                }
            }
    }

    fun retry() {
        load()
        _state.value.query
            .takeIf { it.isNotBlank() }
            ?.let(::search)
    }

    private fun load() {
        if (_state.value.outgoing == null) {
            viewModelScope.launch {
                // A preview that cannot be read leaves the picker as it was: the send does not need it.
                val outgoing =
                    try {
                        withContext(io) { account.preview() }
                    } catch (_: CoreException) {
                        null
                    }
                _state.update { it.copy(outgoing = it.outgoing ?: outgoing) }
            }
        }
        viewModelScope.launch {
            try {
                val all = withContext(io) { account.conversations() }
                _state.update { it.copy(conversations = all.filter(::offered), loaded = true, problem = null) }
            } catch (e: CoreException) {
                _state.update { it.copy(loaded = true, problem = e.problem()) }
            }
        }
    }

    /** A conversation this device can send into, other than the one the pick started from. */
    private fun offered(conversation: Conversation) =
        conversation.id != except &&
            (conversation.state == ConversationState.ACTIVE || conversation.state == ConversationState.NEW)
}

/** How long the search waits for the typing to pause, as the list's search does. */
private const val SEARCH_DELAY_MS = 300L
