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
import samtak.spjall.core.SignInProvider

/**
 * Whether this device is signed in, and the way there (decisions 0019, 0033):
 * an invite link names who invited the person, a sign-in button opens Google
 * or Kenni in a Custom Tab, and the provider's redirect comes back to
 * [complete]. Signed in, the same browser links Kenni to the account
 * ([verify]), and its redirect comes back to [complete] too.
 *
 * The invite token, the provider and an unfinished callback live in [saved],
 * so they survive the process ending while the browser is open; the core
 * keeps the pending sign-in or link itself.
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

    /** Provider URLs for the activity to open in a Custom Tab. */
    val browser: Flow<String> = _browser.receiveAsFlow()

    /** An invite token to open as a 1:1; [signedUp] when it is the link that just let the person in. */
    data class Link(
        val token: String,
        val signedUp: Boolean,
    )

    private val _invites = Channel<Link>(Channel.BUFFERED)

    /** Invite links to open as a 1:1, once signed in (decision 0022). */
    val invites: Flow<Link> = _invites.receiveAsFlow()

    private val _linked = Channel<Unit>(Channel.BUFFERED)

    /** Kenni is linked to the account: its name and mark are now the registry's. */
    val linked: Flow<Unit> = _linked.receiveAsFlow()

    init {
        viewModelScope.launch {
            val signedIn = runCatching { withContext(io) { account.signedIn() } }.getOrDefault(false)
            if (signedIn) {
                signedIn()
            } else {
                _state.update { it.copy(session = Session.SignedOut) }
                saved.get<String>(INVITE)?.let(::resolve)
            }
            // A sign-in or link the process ended in the middle of, or one
            // whose callback came before this check.
            saved.get<String>(CALLBACK)?.let(::redeem)
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

    fun signIn(provider: SignInProvider) {
        saved[PROVIDER] = provider.name
        open { account.beginSignIn(provider) }
    }

    /** Signed in: opens Kenni to link it to the account, for the registry's name and the mark. */
    fun verify() = open { account.beginLink(SignInProvider.KENNI) }

    private fun open(begin: () -> String) {
        if (_state.value.busy) return
        _state.update { it.copy(busy = true, problem = null) }
        viewModelScope.launch {
            try {
                _browser.send(withContext(io) { begin() })
                _state.update { it.copy(busy = false) }
            } catch (e: CoreException) {
                _state.update { it.copy(busy = false, problem = e.problem()) }
            }
        }
    }

    /** No app on the device can open the provider's URL. */
    fun browserMissing() {
        _state.update { it.copy(problem = Problem.Generic) }
    }

    /**
     * The URL the provider redirected to: a link when signed in, else a
     * sign-in. Before the first check it waits for that check to say which.
     */
    fun complete(callback: String) {
        saved[CALLBACK] = callback
        if (_state.value.session != Session.Checking) redeem(callback)
    }

    /** Tries again what failed: the same callback when one is pending, else a new sign-in or link. */
    fun retry() {
        val callback = saved.get<String>(CALLBACK)
        when {
            callback != null -> redeem(callback)
            _state.value.session == Session.SignedIn -> verify()
            else -> signIn(saved.get<String>(PROVIDER)?.let(SignInProvider::valueOf) ?: SignInProvider.GOOGLE)
        }
    }

    /** The account or this device is gone; start over. */
    fun signedOut() {
        saved.remove<String>(INVITE)
        saved.remove<String>(CALLBACK)
        saved.remove<String>(PROVIDER)
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

    /** Finishes the sign-in or, signed in, the link the callback belongs to. */
    private fun redeem(callback: String) {
        val linking = _state.value.session == Session.SignedIn
        _state.update { it.copy(busy = true, problem = null) }
        viewModelScope.launch {
            try {
                if (linking) {
                    withContext(io) { account.completeLink(callback) }
                    saved.remove<String>(CALLBACK)
                    _state.update { it.copy(busy = false) }
                    _linked.trySend(Unit)
                } else {
                    val invite = saved.get<String>(INVITE)
                    withContext(io) { account.completeSignIn(callback, invite) }
                    saved.remove<String>(INVITE)
                    saved.remove<String>(CALLBACK)
                    signedIn()
                    // The link that let the person in also opens its 1:1.
                    invite?.let { _invites.trySend(Link(it, signedUp = true)) }
                }
            } catch (e: CoreException) {
                // Unreachable keeps the sign-in or link pending in the core, so
                // the same callback can finish it; any other failure ended it.
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
        const val PROVIDER = "provider"
    }
}
