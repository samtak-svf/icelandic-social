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
import samtak.spjall.core.Card
import samtak.spjall.core.CardKind
import samtak.spjall.core.CardRef
import samtak.spjall.core.CoreException
import samtak.spjall.core.ModerationAction
import samtak.spjall.core.Report
import samtak.spjall.core.ReportState
import samtak.spjall.core.ReportTargetKind

/**
 * A community's report queue (decision 0066), for its owner and moderators, oldest first, open or closed: what
 * was reported, as a card, and why. A report hides, removes or restores what it names, mutes, unmutes, bans or
 * unbans its author, with a reason that is logged, or an open one is closed without acting; the reason is
 * required either way. A mute lasts a day, a week or 30 days. The API says nothing of whether an author is muted or
 * banned, so both ways are offered and the server answers.
 */
class ReportsViewModel(
    private val communityId: String,
    private val social: Social,
    private val now: () -> Long = System::currentTimeMillis,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {
    data class State(
        /** Which reports are shown: those waiting, or those closed. */
        val showing: ReportState = ReportState.OPEN,
        val reports: List<Report> = emptyList(),
        /** The reported posts and comments, by their id. */
        val cards: Map<String, Card> = emptyMap(),
        /** The reason being written for each report, by report id. */
        val reasons: Map<String, String> = emptyMap(),
        val loaded: Boolean = false,
        val busy: Boolean = false,
        /** The last action was recorded. */
        val done: Boolean = false,
        val problem: Problem? = null,
    )

    /** How long a moderator mutes an author. */
    enum class MutePeriod(
        val days: Long,
    ) {
        Day(1),
        Week(WEEK),
        Month(MONTH),
    }

    /** What a moderator may do with a report: the first three to the content, the last four to its author. */
    enum class Verb { Hide, Remove, Restore, Dismiss, Mute, Unmute, Ban, Unban }

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    private var failed: (() -> Unit)? = null

    init {
        load()
    }

    fun load() {
        perform(::load) { reload() }
    }

    /** Shows the reports in [state] instead. */
    fun show(state: ReportState) {
        if (state == _state.value.showing || _state.value.busy) return
        _state.update {
            it.copy(
                showing = state,
                reports = emptyList(),
                cards = emptyMap(),
                loaded = false,
                done = false,
            )
        }
        load()
    }

    fun reason(
        reportId: String,
        text: String,
    ) {
        if (text.length <=
            REASON_LIMIT
        ) {
            _state.update { it.copy(reasons = it.reasons + (reportId to text), done = false) }
        }
    }

    /**
     * Acts on the report: on what it names or on its author, or closes it. An open report is closed by the action;
     * a closed one is not named, since the server takes only an open one. The queue is then asked for again.
     */
    fun act(
        report: Report,
        verb: Verb,
        period: MutePeriod? = null,
    ) {
        val reason =
            _state.value.reasons[report.reportId]
                ?.trim()
                .orEmpty()
        val step = if (reason.isEmpty()) null else step(report, verb, reason, period)
        if (step == null) return
        perform({ act(report, verb, period) }) {
            step()
            _state.update { it.copy(reasons = it.reasons - report.reportId) }
            reload()
            _state.update { it.copy(done = true) }
        }
    }

    fun retry() {
        failed?.invoke()
    }

    /** The call that does [verb] about [report], or null when it does not apply to it; a mute needs its [period]. */
    private fun step(
        report: Report,
        verb: Verb,
        reason: String,
        period: MutePeriod?,
    ): (() -> Unit)? {
        val open = report.state == ReportState.OPEN
        if (verb == Verb.Dismiss) return { social.closeReport(report.reportId, reason) }.takeIf { open }
        val action = report.action(verb)
        val target = if (verb in MEMBER_VERBS) report.member() else report.target.id
        // A mute is for a time (decision 0063): it ends that long from now, in Unix ms.
        val mute = action == ModerationAction.MUTE_MEMBER
        val until = if (mute) period?.let { (now() + it.days * DAY).toULong() } else null
        val timed = !mute || until != null
        return if (action == null || target == null || !timed) {
            null
        } else {
            { social.moderate(communityId, action, target, reason, report.reportId.takeIf { open }, until) }
        }
    }

    private fun reload() {
        val reports = social.communityReports(communityId, _state.value.showing, null, PAGE).reports
        val refs =
            reports.mapNotNull {
                when (it.target.kind) {
                    ReportTargetKind.POST -> CardRef(CardKind.POST, it.target.id)
                    ReportTargetKind.COMMENT -> CardRef(CardKind.COMMENT, it.target.id)
                    else -> null
                }
            }
        val cards = if (refs.isEmpty()) emptyList() else social.cards(refs)
        _state.update { state ->
            state.copy(reports = reports, cards = cards.associateBy { it.id() }, loaded = true)
        }
    }

    private fun perform(
        again: () -> Unit,
        action: () -> Unit,
    ) {
        if (_state.value.busy) return
        _state.update { it.copy(busy = true, done = false, problem = null) }
        viewModelScope.launch {
            try {
                withContext(io) { action() }
                failed = null
                _state.update { it.copy(busy = false) }
            } catch (e: CoreException) {
                failed = again
                _state.update { it.copy(busy = false, loaded = true, problem = e.problem()) }
            }
        }
    }
}

/** What each verb does to the author, rather than to what was reported. */
private val MEMBER_VERBS =
    mapOf(
        ReportsViewModel.Verb.Mute to ModerationAction.MUTE_MEMBER,
        ReportsViewModel.Verb.Unmute to ModerationAction.UNMUTE_MEMBER,
        ReportsViewModel.Verb.Ban to ModerationAction.BAN_MEMBER,
        ReportsViewModel.Verb.Unban to ModerationAction.UNBAN_MEMBER,
    )

private val POST_VERBS =
    mapOf(
        ReportsViewModel.Verb.Hide to ModerationAction.HIDE_POST,
        ReportsViewModel.Verb.Remove to ModerationAction.REMOVE_POST,
        ReportsViewModel.Verb.Restore to ModerationAction.RESTORE_POST,
    )

private val COMMENT_VERBS =
    mapOf(
        ReportsViewModel.Verb.Hide to ModerationAction.HIDE_COMMENT,
        ReportsViewModel.Verb.Remove to ModerationAction.REMOVE_COMMENT,
        ReportsViewModel.Verb.Restore to ModerationAction.RESTORE_COMMENT,
    )

/** The account a report's member verbs act on: whose content it is, or the account reported; none once deleted. */
fun Report.member(): String? = targetAccount?.accountId ?: target.id.takeIf { target.kind == ReportTargetKind.ACCOUNT }

/**
 * What [verb] does about [this]: to the post or comment it names, or to its author. A community is not moderated
 * here, an account's content is not hidden, and a deleted author is not muted or banned.
 */
fun Report.action(verb: ReportsViewModel.Verb): ModerationAction? =
    when {
        verb in MEMBER_VERBS -> member()?.let { MEMBER_VERBS[verb] }
        target.kind == ReportTargetKind.POST -> POST_VERBS[verb]
        target.kind == ReportTargetKind.COMMENT -> COMMENT_VERBS[verb]
        else -> null
    }

/** The id a card was asked for by. */
fun Card.id(): String =
    when (this) {
        is Card.Unavailable -> reference.id
        is Card.Post -> reference.id
        is Card.Comment -> reference.id
        is Card.Community -> reference.id
    }

/** A page of reports. */
private const val PAGE = 50u

/** A week and a month of mute, in days. */
private const val WEEK = 7L
private const val MONTH = 30L

/** A day, in milliseconds. */
private const val DAY = 24L * 60 * 60 * 1000
