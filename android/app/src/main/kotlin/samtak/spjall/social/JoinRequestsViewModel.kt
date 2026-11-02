package samtak.spjall.social

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import samtak.spjall.account.Problem
import samtak.spjall.base.BaseViewModel
import samtak.spjall.base.ScreenState
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
) : BaseViewModel<JoinRequestsViewModel.State>(State(), io) {
    data class State(
        val requests: List<JoinRequest> = emptyList(),
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

    fun approve(accountId: String) {
        perform({ approve(accountId) }) { ask { social.approveJoinRequest(communityId, accountId) } }
    }

    fun decline(accountId: String) {
        perform({ decline(accountId) }) { ask { social.declineJoinRequest(communityId, accountId) } }
    }

    /** Runs [write], if any, then asks for the list again. */
    private suspend fun ask(write: suspend () -> Unit = {}) {
        val requests =
            withContext(io) {
                write()
                social.joinRequests(communityId)
            }
        edit { it.copy(requests = requests, loaded = true) }
    }
}
