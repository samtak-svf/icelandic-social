package samtak.spjall.people

import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import samtak.spjall.account.Account
import samtak.spjall.account.Problem
import samtak.spjall.account.problem
import samtak.spjall.base.BaseViewModel
import samtak.spjall.base.ScreenState
import samtak.spjall.core.ConversationState
import samtak.spjall.core.CoreException
import samtak.spjall.core.Person
import samtak.spjall.socket.Live

/**
 * The new-conversation picker (decisions 0022, 0036, 0078): the people met through
 * a shared conversation, then everyone else signed in, a page at a time, and
 * a name search over the whole directory. A tap on a person opens the 1:1
 * with them at once (decision 0043); `new_group` switches to picking several,
 * and more than one picked start a group. Given [targetConversation] it adds
 * people to that group instead, with everyone already in it shown as taken.
 */
@Suppress("TooManyFunctions") // One per thing the picker does, as PeopleActions lists them.
class PeopleViewModel(
    private val account: Account,
    private val live: Live,
    private val io: CoroutineDispatcher = Dispatchers.IO,
    private val targetConversation: String? = null,
    private val existingMembers: Set<String> = emptySet(),
) : BaseViewModel<PeopleViewModel.State>(opened(targetConversation, existingMembers), io) {
    data class State(
        /** The people met through a shared conversation. */
        val people: List<Person> = emptyList(),
        /** The search as typed. */
        val query: String = "",
        /** The directory's pages so far, for [query]. */
        val directory: List<Person> = emptyList(),
        /** The cursor of the directory's next page, null on the last. */
        val next: String? = null,
        /** A search or a further page is on its way. */
        val searching: Boolean = false,
        val loaded: Boolean = false,
        /** Picking several for a group, each row a checkbox; otherwise a tap opens a 1:1 (decision 0043). */
        val group: Boolean = false,
        /** Account ids, in the order they were picked. */
        val picked: List<String> = emptyList(),
        /** Adding to a group that exists (0078): there is no mode to leave, and the title says so. */
        val adding: Boolean = false,
        /** Already in that group: shown checked, and not to be picked. */
        val existing: Set<String> = emptySet(),
        override val busy: Boolean = false,
        override val problem: Problem? = null,
    ) : ScreenState<State> {
        /** Whom the list shows below [people]: without a search, the people met are not shown twice. */
        val everyone: List<Person>
            get() =
                if (query.isBlank()) {
                    val met = people.mapTo(HashSet()) { it.account }
                    directory.filterNot { it.account in met }
                } else {
                    directory
                }

        override fun busy(on: Boolean): State = copy(busy = on)

        override fun trouble(problem: Problem?): State = copy(problem = problem)

        override fun answered(): State = copy(loaded = true)
    }

    private val _opened = Channel<String>(Channel.BUFFERED)

    /** The conversation to go into. */
    val opened: Flow<String> = _opened.receiveAsFlow()

    private var searchJob: Job? = null

    init {
        load()
    }

    /** `new_group`: the rows become checkboxes. */
    fun group() {
        edit { it.copy(group = true) }
    }

    /** Back out of picking several: the picks are dropped, and a tap opens a 1:1 again. */
    fun single() {
        edit { it.copy(group = false, picked = emptyList()) }
    }

    /** Into the 1:1 with [person], made when there is none. */
    fun open(person: String) {
        perform({ open(person) }) {
            val id = account.openDirect(person)
            live.sync()
            _opened.send(id)
        }
    }

    fun toggle(account: String) {
        // Whoever is already in the group stays so; the row is shown taken.
        if (account in current.existing) return
        edit { state ->
            state.copy(picked = if (account in state.picked) state.picked - account else state.picked + account)
        }
    }

    fun start() {
        val picked = current.picked
        if (picked.isEmpty()) return
        val target = targetConversation
        if (target != null) {
            perform(::start) {
                account.addAccounts(target, picked)
                live.sync()
                _opened.send(target)
            }
            return
        }
        perform(::start) {
            val id = existing(picked) ?: account.createConversation(picked).also { live.sync() }
            _opened.send(id)
        }
    }

    fun search(text: String) {
        edit { it.copy(query = text) }
        searchJob?.cancel()
        searchJob =
            viewModelScope.launch {
                delay(SEARCH_DELAY_MS)
                page(text, after = null)
            }
    }

    fun more() {
        val state = current
        val next = state.next ?: return
        if (state.searching || searchJob?.isActive == true) return
        searchJob = viewModelScope.launch { page(state.query, after = next) }
    }

    /** A page of the directory for [query]: the first replaces what was shown, a later one adds to it. */
    private suspend fun page(
        query: String,
        after: String?,
    ) {
        edit { it.copy(searching = true, problem = null) }
        try {
            val page = withContext(io) { account.directory(query.trim().ifEmpty { null }, after, PAGE) }
            failed = null
            edit {
                it.copy(
                    directory = if (after == null) page.people else it.directory + page.people,
                    next = page.next,
                    searching = false,
                )
            }
        } catch (e: CoreException) {
            failed = { search(current.query) }
            edit { it.copy(searching = false, problem = e.problem()) }
        }
    }

    private fun load() {
        perform(::load) {
            val people = withContext(io) { account.people() }
            val page = withContext(io) { account.directory(null, null, PAGE) }
            // Who is already in the group being added to, when the screen was not told (0078).
            val existing =
                if (targetConversation != null && current.existing.isEmpty()) {
                    withContext(io) { membersOf(targetConversation) }
                } else {
                    current.existing
                }
            edit {
                it.copy(people = people, directory = page.people, next = page.next, loaded = true, existing = existing)
            }
        }
    }

    /** Everyone already in [conversation], as account ids; empty when this device does not have it. */
    private fun membersOf(conversation: String): Set<String> =
        account
            .conversations()
            .firstOrNull { it.id == conversation }
            ?.members
            ?.mapTo(
                HashSet(),
            ) { it.account }
            .orEmpty()

    /** The 1:1 with this one person, if there is one to go back to. */
    private fun existing(picked: List<String>): String? =
        picked.singleOrNull()?.let { person ->
            account
                .conversations()
                .firstOrNull { c ->
                    // A conversation this account left is not one to go back into (0078).
                    c.state != ConversationState.REMOVED &&
                        c.state != ConversationState.LEFT &&
                        c.members.map { it.account } == listOf(person)
                }?.id
        }
}

/** How long the search waits for the typing to pause. */
private const val SEARCH_DELAY_MS = 300L

/** A directory page: a screenful and some. */
private const val PAGE = 30u

/** The state the picker opens with: adding to a group that exists (0078), or the plain one. */
private fun opened(
    target: String?,
    existing: Set<String>,
): PeopleViewModel.State =
    if (target == null) {
        PeopleViewModel.State()
    } else {
        PeopleViewModel.State(group = true, adding = true, existing = existing)
    }
