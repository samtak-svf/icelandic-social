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
import samtak.spjall.core.ModerationStatement

/**
 * What moderators did to this account's content and why (decisions 0063, 0115), newest first. A decision can be
 * reviewed once; the list is asked for again after asking.
 */
class StatementsViewModel(
    private val social: Social,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {
    data class State(
        val statements: List<ModerationStatement> = emptyList(),
        val next: String? = null,
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

    fun ask(entryId: ULong) {
        perform({ ask(entryId) }) { social.askModerationReview(entryId) }
    }

    fun more() {
        val next = _state.value.next ?: return
        if (_state.value.busy) return
        _state.update { it.copy(busy = true, problem = null) }
        viewModelScope.launch {
            try {
                val page = withContext(io) { social.moderationStatements(next, PAGE) }
                failed = null
                _state.update {
                    it.copy(statements = it.statements + page.statements, next = page.next, busy = false)
                }
            } catch (e: CoreException) {
                failed = ::more
                _state.update { it.copy(busy = false, problem = e.problem()) }
            }
        }
    }

    fun retry() {
        failed?.invoke()
    }

    /** Runs [action], if any, then asks for the list again from its start. */
    private fun perform(
        again: () -> Unit,
        action: () -> Unit,
    ) {
        if (_state.value.busy) return
        _state.update { it.copy(busy = true, problem = null) }
        viewModelScope.launch {
            try {
                val page =
                    withContext(io) {
                        action()
                        social.moderationStatements(null, PAGE)
                    }
                failed = null
                _state.update { it.copy(statements = page.statements, next = page.next, loaded = true, busy = false) }
            } catch (e: CoreException) {
                failed = again
                _state.update { it.copy(busy = false, loaded = true, problem = e.problem()) }
            }
        }
    }
}

/** A page of statements. */
private const val PAGE = 30u

/** What the statements screen does. */
interface StatementsActions {
    fun back()

    fun retry()

    fun more()

    fun ask(entryId: ULong)
}
