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
import samtak.spjall.core.JoinRequest

/**
 * The join requests that wait in a private community (#354, decision 0070), oldest first, for its owner and
 * moderators. Approving one makes the account a member; declining one lets it ask again after 30 days. The list is
 * asked for again after each answer.
 */
class JoinRequestsViewModel(
    private val communityId: String,
    private val social: Social,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {
    data class State(
        val requests: List<JoinRequest> = emptyList(),
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

    fun approve(accountId: String) {
        perform({ approve(accountId) }) { social.approveJoinRequest(communityId, accountId) }
    }

    fun decline(accountId: String) {
        perform({ decline(accountId) }) { social.declineJoinRequest(communityId, accountId) }
    }

    fun retry() {
        failed?.invoke()
    }

    /** Runs [action], if any, then asks for the list again. */
    private fun perform(
        again: () -> Unit,
        action: () -> Unit,
    ) {
        if (_state.value.busy) return
        _state.update { it.copy(busy = true, problem = null) }
        viewModelScope.launch {
            try {
                val requests =
                    withContext(io) {
                        action()
                        social.joinRequests(communityId)
                    }
                failed = null
                _state.update { it.copy(requests = requests, loaded = true, busy = false) }
            } catch (e: CoreException) {
                failed = again
                _state.update { it.copy(busy = false, loaded = true, problem = e.problem()) }
            }
        }
    }
}
