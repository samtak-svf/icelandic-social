package samtak.spjall.me.link

import androidx.annotation.StringRes
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
import samtak.spjall.brand.R
import samtak.spjall.core.CoreException
import samtak.spjall.core.LinkRequest
import samtak.spjall.core.isLinkCode
import samtak.spjall.limits.Limits

/**
 * Links a browser to this account (decisions 0064, 0077): the code the browser shows is scanned or pasted,
 * checked against the server, and approved with a choice of how much history the browser gets.
 *
 * The core's calls block, so they run on [io]. [isCode] and [now] are the core's text check and the clock,
 * passed in so a JVM test needs neither the native library nor real time.
 */
class LinkViewModel(
    private val account: Account,
    private val isCode: (String) -> Boolean = ::isLinkCode,
    private val now: () -> Long = System::currentTimeMillis,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {
    /** How much of the history on this phone the browser gets (0077). */
    enum class History { RECENT, ALL, NONE }

    /** Why a code was refused, with the sentence that says so. */
    enum class Reason(
        @StringRes val text: Int,
    ) {
        INVALID(R.string.device_link_invalid),
        MISMATCH(R.string.device_link_mismatch),
        EXPIRED(R.string.device_link_expired),
        ALREADY(R.string.device_link_already),
    }

    sealed interface State {
        /** The camera is looking for the code. */
        data object Scanning : State

        /** The person is typing or pasting the code. */
        data object Pasting : State

        data object Inspecting : State

        /** The browser the code names, and what the person chose to send it. */
        data class Approve(
            val request: LinkRequest,
            val history: History = History.RECENT,
        ) : State

        /** The phone is sealing and uploading what [history] chose. */
        data class Sending(
            val history: History,
        ) : State

        data object Done : State

        /** The code cannot be used: [Reason] says why, and the person tries another. */
        data class Refused(
            val reason: Reason,
        ) : State

        /** Something else went wrong, and trying again may work. */
        data class Failed(
            val problem: Problem,
        ) : State
    }

    private val _state = MutableStateFlow<State>(State.Scanning)
    val state: StateFlow<State> = _state.asStateFlow()

    private var code: String? = null
    private var retry: (() -> Unit)? = null

    fun paste() {
        if (_state.value is State.Scanning) _state.value = State.Pasting
    }

    fun scan() {
        if (_state.value is State.Pasting) _state.value = State.Scanning
    }

    /** Back to looking for a code, after a refusal or a failure. */
    fun again() {
        code = null
        _state.value = State.Scanning
    }

    /**
     * Text from the camera or the field. Anything but a link code is refused before the server hears of it,
     * and a code arriving while another is being checked is dropped: the camera sees one many times.
     */
    fun submit(text: String) {
        if (_state.value !is State.Scanning && _state.value !is State.Pasting) return
        val trimmed = text.trim()
        if (!isCode(trimmed)) {
            _state.value = State.Refused(Reason.INVALID)
            return
        }
        code = trimmed
        inspect(trimmed)
    }

    fun choose(history: History) {
        _state.update { if (it is State.Approve) it.copy(history = history) else it }
    }

    fun approve() {
        val current = _state.value as? State.Approve ?: return
        val code = code ?: return
        val since = if (current.history == History.RECENT) (now() - RECENT_MILLIS).toULong() else null
        run(State.Sending(current.history), ::approve) {
            account.approveLink(code, since, send = current.history != History.NONE)
            State.Done
        }
    }

    /** Tries the call that failed again. */
    fun retry() {
        retry?.invoke()
    }

    private fun inspect(code: String) {
        run(State.Inspecting, { inspect(code) }) {
            val request = account.inspectLink(code)
            if (request.approved) State.Refused(Reason.ALREADY) else State.Approve(request)
        }
    }

    /** Shows [during], runs [call] off the main thread, and shows what it returns or why it failed. */
    private fun run(
        during: State,
        again: () -> Unit,
        call: () -> State,
    ) {
        _state.value = during
        viewModelScope.launch {
            _state.value =
                try {
                    withContext(io) { call() }.also { retry = null }
                } catch (e: CoreException) {
                    val reason = e.refused()
                    retry = again.takeIf { reason == null }
                    reason?.let(State::Refused) ?: State.Failed(e.problem())
                }
        }
    }

    private fun CoreException.refused(): Reason? =
        when (this) {
            is CoreException.LinkCodeInvalid -> Reason.INVALID
            is CoreException.LinkKeyMismatch -> Reason.MISMATCH
            is CoreException.LinkExpired -> Reason.EXPIRED
            is CoreException.LinkAlreadyApproved -> Reason.ALREADY
            else -> null
        }
}

/** "Síðustu 90 dagar" (0077). */
private const val RECENT_MILLIS = Limits.LINK_RECENT_DAYS * 24L * 60 * 60 * 1000
