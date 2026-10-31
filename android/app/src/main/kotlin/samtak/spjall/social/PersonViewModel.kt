package samtak.spjall.social

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import samtak.spjall.account.Problem
import samtak.spjall.account.problem
import samtak.spjall.core.CoreException
import samtak.spjall.core.PersonProfile

/**
 * One account as this one sees it (decision 0114): the relation between them and the action each relation has,
 * and the snooze. The profile is asked for again after each action, so the screen shows what the server holds.
 */
class PersonViewModel(
    private val accountId: String,
    private val social: Social,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {
    data class State(
        val profile: PersonProfile? = null,
        val loaded: Boolean = false,
        val busy: Boolean = false,
        val problem: Problem? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    private var failed: (() -> Unit)? = null

    init {
        load()
    }

    fun load() {
        perform(::load) {}
    }

    fun add() = perform(::add) { social.sendFriendRequest(accountId) }

    fun cancel() = perform(::cancel) { social.cancelFriendRequest(accountId) }

    fun accept() = perform(::accept) { social.acceptFriendRequest(accountId) }

    fun decline() = perform(::decline) { social.declineFriendRequest(accountId) }

    fun end() = perform(::end) { social.endFriendship(accountId) }

    fun snooze() = perform(::snooze) { social.snoozePerson(accountId) }

    fun unsnooze() = perform(::unsnooze) { social.unsnoozePerson(accountId) }

    fun retry() {
        failed?.invoke()
    }

    /** Runs [action], if any, then asks for the profile again; a refusal leaves the old profile in view. */
    private fun perform(
        again: () -> Unit,
        action: () -> Unit,
    ) {
        if (_state.value.busy) return
        _state.update { it.copy(busy = true, problem = null) }
        viewModelScope.launch {
            try {
                val profile =
                    withContext(io) {
                        action()
                        social.person(accountId)
                    }
                failed = null
                _state.update { it.copy(profile = profile, loaded = true, busy = false) }
            } catch (e: CoreException) {
                failed = again
                _state.update { it.copy(busy = false, loaded = true, problem = e.problem()) }
            }
        }
    }
}
