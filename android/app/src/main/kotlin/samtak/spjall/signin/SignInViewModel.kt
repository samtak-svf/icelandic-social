package samtak.spjall.signin

import androidx.lifecycle.SavedStateHandle
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
import samtak.spjall.core.CoreException

/**
 * Whether this device is signed in, and the way there (decision 0019): an
 * invite link names who invited the person, the sign-in button opens Kenni in
 * a Custom Tab, and Kenni's redirect comes back to [complete].
 *
 * The invite token and an unfinished callback live in [saved], so they
 * survive the process ending while the browser is open; the core keeps the
 * pending sign-in itself.
 */
class SignInViewModel(
    private val account: Account,
    private val saved: SavedStateHandle,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {
    enum class Session { Checking, SignedOut, SignedIn }

    sealed interface Invite {
        /** No invite link was opened. */
        data object None : Invite

        data object Loading : Invite

        /** [name] is null when the operator sent the link or the inviter has no name. */
        data class From(
            val name: String?,
        ) : Invite

        data object Expired : Invite
    }

    data class State(
        val session: Session = Session.Checking,
        val invite: Invite = Invite.None,
        val busy: Boolean = false,
        val problem: Problem? = null,
        /** Counts sign-ins, so each one gets a fresh "Ég" screen. */
        val signIns: Int = 0,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    private val _browser = Channel<String>(Channel.BUFFERED)

    /** Kenni URLs for the activity to open in a Custom Tab. */
    val browser: Flow<String> = _browser.receiveAsFlow()

    /** An invite token to open as a 1:1; [signedUp] when it is the link that just let the person in. */
    data class Link(
        val token: String,
        val signedUp: Boolean,
    )

    private val _invites = Channel<Link>(Channel.BUFFERED)

    /** Invite links to open as a 1:1, once signed in (decision 0022). */
    val invites: Flow<Link> = _invites.receiveAsFlow()

    init {
        viewModelScope.launch {
            val signedIn = runCatching { withContext(io) { account.signedIn() } }.getOrDefault(false)
            // A callback that arrived meanwhile may have signed in already.
            if (_state.value.session != Session.Checking) return@launch
            if (signedIn) {
                signedIn()
            } else {
                _state.update { it.copy(session = Session.SignedOut) }
                saved.get<String>(INVITE)?.let(::resolve)
                saved.get<String>(CALLBACK)?.let(::finish)
            }
        }
    }

    /** An invite link was opened: it signs the person in, or, signed in, opens the 1:1 with its maker. */
    fun openInvite(token: String) {
        if (_state.value.session == Session.SignedIn) {
            _invites.trySend(Link(token, signedUp = false))
            return
        }
        saved[INVITE] = token
        resolve(token)
    }

    fun signIn() {
        if (_state.value.busy) return
        _state.update { it.copy(busy = true, problem = null) }
        viewModelScope.launch {
            try {
                _browser.send(withContext(io) { account.beginSignIn() })
                _state.update { it.copy(busy = false) }
            } catch (e: CoreException) {
                _state.update { it.copy(busy = false, problem = e.problem()) }
            }
        }
    }

    /** No app on the device can open the Kenni URL. */
    fun browserMissing() {
        _state.update { it.copy(problem = Problem.Generic) }
    }

    /** The URL Kenni redirected to. */
    fun complete(callback: String) {
        saved[CALLBACK] = callback
        finish(callback)
    }

    /** Tries again what failed: the same callback when one is pending, else a new sign-in. */
    fun retry() {
        val callback = saved.get<String>(CALLBACK)
        if (callback != null) finish(callback) else signIn()
    }

    /** The account or this device is gone; start over. */
    fun signedOut() {
        saved.remove<String>(INVITE)
        saved.remove<String>(CALLBACK)
        _state.update { State(session = Session.SignedOut, signIns = it.signIns) }
    }

    private fun resolve(token: String) {
        _state.update { it.copy(invite = Invite.Loading) }
        viewModelScope.launch {
            val invite =
                try {
                    Invite.From(withContext(io) { account.resolveInvite(token) }?.name)
                } catch (e: CoreException) {
                    // Only a 404 says the link is dead. Unreachable says nothing
                    // about it, and signing in will try the token anyway.
                    if (e.isNotFound()) Invite.Expired else Invite.From(null)
                }
            _state.update { it.copy(invite = invite) }
        }
    }

    private fun finish(callback: String) {
        _state.update { it.copy(busy = true, problem = null) }
        viewModelScope.launch {
            try {
                val invite = saved.get<String>(INVITE)
                withContext(io) { account.completeSignIn(callback, invite) }
                saved.remove<String>(INVITE)
                saved.remove<String>(CALLBACK)
                signedIn()
                // The link that let the person in also opens its 1:1.
                invite?.let { _invites.trySend(Link(it, signedUp = true)) }
            } catch (e: CoreException) {
                // Unreachable keeps the sign-in pending in the core, so the same
                // callback can finish it; any other failure ended it.
                if (e !is CoreException.Unreachable) saved.remove<String>(CALLBACK)
                _state.update { it.copy(busy = false, problem = e.problem()) }
            }
        }
    }

    private fun signedIn() {
        _state.update { State(session = Session.SignedIn, signIns = it.signIns + 1) }
        viewModelScope.launch {
            // Best effort: the last-resort KeyPackage covers a failure, and the
            // next launch tries again.
            runCatching { withContext(io) { account.stockKeyPackages() } }
        }
    }

    private companion object {
        const val INVITE = "invite"
        const val CALLBACK = "callback"
    }
}
