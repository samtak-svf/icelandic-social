package samtak.spjall.social

import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import samtak.spjall.account.Problem
import samtak.spjall.account.problem
import samtak.spjall.base.BaseViewModel
import samtak.spjall.base.ScreenState
import samtak.spjall.core.CoreException
import samtak.spjall.core.ModerationStatement

/**
 * What moderators did to this account's content and why (decisions 0063, 0115), newest first. A decision can be
 * reviewed once; the list is asked for again after asking.
 */
class StatementsViewModel(
    private val social: Social,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) : BaseViewModel<StatementsViewModel.State>(State(), io) {
    data class State(
        val statements: List<ModerationStatement> = emptyList(),
        val next: String? = null,
        val loaded: Boolean = false,
        override val busy: Boolean = false,
        override val problem: Problem? = null,
    ) : ScreenState<State> {
        override fun busy(on: Boolean): State = copy(busy = on)

        override fun trouble(problem: Problem?): State = copy(problem = problem)

        override fun answered(): State = copy(loaded = true)
    }

    init {
        load()
    }

    fun load() {
        perform(::load) { ask() }
    }

    fun ask(entryId: ULong) {
        perform({ ask(entryId) }) { ask { social.askModerationReview(entryId) } }
    }

    /** The end of the list came into view: the next, older page, added to what is shown. */
    fun more() {
        val next = current.next ?: return
        if (current.busy) return
        edit { it.busy(true).trouble(null) }
        viewModelScope.launch {
            try {
                val page = withContext(io) { social.moderationStatements(next, PAGE) }
                failed = null
                edit {
                    it.copy(statements = it.statements + page.statements, next = page.next, busy = false)
                }
            } catch (e: CoreException) {
                failed = ::more
                edit { it.busy(false).trouble(e.problem()) }
            }
        }
    }

    /** Runs [write], if any, then asks for the list again from its start. */
    private suspend fun ask(write: suspend () -> Unit = {}) {
        val page =
            withContext(io) {
                write()
                social.moderationStatements(null, PAGE)
            }
        edit { it.copy(statements = page.statements, next = page.next, loaded = true) }
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
