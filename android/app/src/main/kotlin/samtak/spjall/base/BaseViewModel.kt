package samtak.spjall.base

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
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

/**
 * A screen that does one thing at a time: [perform] holds the state [ScreenState.busy] while its action runs,
 * asks again for nothing meanwhile, and leaves the reason on screen when the action fails, with [retry] to
 * ask for it again (decisions 0037, 0049). The state is the screen's own, and each screen only says how it is
 * busy, how it shows a problem and how it says it answered.
 */
abstract class BaseViewModel<S : ScreenState<S>>(
    initial: S,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {
    private val _state = MutableStateFlow(initial)

    val state: StateFlow<S> = _state.asStateFlow()

    /** The state as it is now. */
    protected val current: S get() = _state.value

    /** What to run again when the person asks for the failed thing once more; none after a success. */
    protected var failed: (() -> Unit)? = null

    /** Asks again for the thing that failed, if the screen shows one. */
    open fun retry() {
        failed?.invoke()
    }

    /** Writes the state, for the screen that does more than [perform] does. */
    protected fun edit(change: (S) -> S) = _state.update(change)

    /**
     * Runs [action] away from the main thread, unless something already is. A success clears [ScreenState.busy];
     * a failure says why through [shown], which by default leaves the reason on a screen that has answered.
     * [again] is what [retry] runs.
     */
    @Suppress("TooGenericExceptionCaught") // Any failure is the person's to see; a cancellation is not.
    protected fun perform(
        again: () -> Unit,
        shown: (S, Problem) -> S = { state, problem -> state.trouble(problem).answered() },
        action: suspend () -> Unit,
    ) {
        if (current.busy) return
        edit { it.busy(true).trouble(null) }
        viewModelScope.launch {
            try {
                withContext(io) { action() }
                failed = null
                edit { it.busy(false) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                failed = again
                edit { shown(it.busy(false), e.problem()) }
            }
        }
    }
}
