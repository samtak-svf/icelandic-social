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
import samtak.spjall.core.Person
import samtak.spjall.core.Settings
import java.io.File
import java.io.IOException

/**
 * "Ég" (decisions 0009, 0019, 0022, 0024): who the person is, their invite
 * link, the read-marker and typing toggles, who they blocked, their devices,
 * and deleting the account.
 *
 * The link is made only when the person asks for one. Making one ends the
 * link before it, so doing it on its own would silently kill a link another
 * device of the account has already shared.
 *
 * One function per thing [MeActions] offers, which is why it is long.
 */
@Suppress("TooManyFunctions")
class MeViewModel(
    private val account: Account,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {
    data class State(
        val me: Me? = null,
        val link: String? = null,
        val settings: Settings? = null,
        val blocked: List<Person> = emptyList(),
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
            val settings = account.settings()
            val blocked = account.blocked()
            _state.update { it.copy(me = me, link = link, settings = settings, blocked = blocked) }
        }
    }

    /** A new link, which ends the one before. */
    fun newLink() {
        perform(::newLink) {
            val link = account.rotateInvite()
            _state.update { it.copy(link = link) }
        }
    }

    /** Off stops both sending and seeing read markers (0022). */
    fun readMarkers(on: Boolean) {
        change { it.copy(readMarkers = on) }
    }

    /** Off stops both sending and seeing typing (0022). */
    fun typing(on: Boolean) {
        change { it.copy(typing = on) }
    }

    fun unblock(account: String) {
        perform({ unblock(account) }) {
            this.account.unblock(account)
            val blocked = this.account.blocked()
            _state.update { it.copy(blocked = blocked) }
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

    /**
     * Sets the photo from the file [read] makes, already a small square (decision 0039), and deletes that file
     * once the core has sent it, whether or not the server took it: the server keeps the only copy.
     */
    fun setPhoto(read: () -> File) {
        perform({ setPhoto(read) }) {
            val file = read()
            try {
                account.setPhoto(file.path)
            } finally {
                file.delete()
            }
            val me = account.me()
            _state.update { it.copy(me = me) }
        }
    }

    /** Removes the photo, for everyone. */
    fun removePhoto() {
        perform(::removePhoto) {
            account.removePhoto()
            val me = account.me()
            _state.update { it.copy(me = me) }
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

    private fun change(edit: (Settings) -> Settings) {
        val settings = _state.value.settings?.let(edit) ?: return
        perform({ change(edit) }) {
            account.setSettings(settings)
            _state.update { it.copy(settings = settings) }
        }
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
            } catch (_: IOException) {
                // The picked photo could not be read or made smaller.
                failed = again
                _state.update { it.copy(busy = false, problem = Problem.Generic()) }
            }
        }
    }
}
