package samtak.spjall.people

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
import samtak.spjall.core.ConversationState
import samtak.spjall.core.CoreException
import samtak.spjall.core.Person
import samtak.spjall.socket.Live

/**
 * The new-conversation picker (decision 0022): the people met through a
 * shared conversation, and no search. One person opens the 1:1 there already
 * is with them; more start a group.
 */
class PeopleViewModel(
    private val account: Account,
    private val live: Live,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {
    data class State(
        val people: List<Person> = emptyList(),
        val loaded: Boolean = false,
        /** Account ids, in the order they were picked. */
        val picked: List<String> = emptyList(),
        val busy: Boolean = false,
        val problem: Problem? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    private val _opened = Channel<String>(Channel.BUFFERED)

    /** The conversation to go into. */
    val opened: Flow<String> = _opened.receiveAsFlow()

    private var failed: (() -> Unit)? = null

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

    fun retry() {
        failed?.invoke()
    }

    private fun load() {
        perform(::load) {
            val people = withContext(io) { account.people() }
            _state.update { it.copy(people = people, loaded = true) }
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
