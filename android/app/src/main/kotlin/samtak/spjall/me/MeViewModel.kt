package samtak.spjall.me

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
import samtak.spjall.account.Account
import samtak.spjall.account.Problem
import samtak.spjall.account.problem
import samtak.spjall.core.CoreException
import samtak.spjall.core.Me

/**
 * "Ég" (decisions 0009, 0019): who the person is, their invite link, their
 * devices, and deleting the account.
 *
 * The link is made only when the person asks for one. Making one ends the
 * link before it, so doing it on its own would silently kill a link another
 * device of the account has already shared.
 */
class MeViewModel(
    private val account: Account,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {
    data class State(
        val me: Me? = null,
        val link: String? = null,
        val busy: Boolean = false,
        val problem: Problem? = null,
        /** This device was revoked or the account deleted: back to sign-in. */
        val signedOut: Boolean = false,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    private var failed: (() -> Unit)? = null

    init {
        load()
    }

    fun load() {
        perform(::load) {
            val me = account.me()
            val link = account.inviteLink()
            _state.update { it.copy(me = me, link = link) }
        }
    }

    /** A new link, which ends the one before. */
    fun newLink() {
        perform(::newLink) {
            val link = account.rotateInvite()
            _state.update { it.copy(link = link) }
        }
    }

    fun revoke(deviceId: String) {
        perform({ revoke(deviceId) }) {
            val current =
                _state.value.me
                    ?.devices
                    ?.any { it.deviceId == deviceId && it.current } == true
            account.revokeDevice(deviceId)
            if (current) {
                _state.update { it.copy(signedOut = true) }
            } else {
                val me = account.me()
                _state.update { it.copy(me = me) }
            }
        }
    }

    fun deleteAccount() {
        perform(::deleteAccount) {
            account.deleteAccount()
            _state.update { it.copy(signedOut = true) }
        }
    }

    /** Tries the action that failed again. */
    fun retry() {
        failed?.invoke()
    }

    /** Runs [action] off the main thread, one at a time; on failure, [again] is what [retry] repeats. */
    private fun perform(
        again: () -> Unit,
        action: () -> Unit,
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
                _state.update { it.copy(busy = false, problem = e.problem()) }
            }
        }
    }
}
