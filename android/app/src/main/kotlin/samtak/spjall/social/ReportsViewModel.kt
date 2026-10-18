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
import samtak.spjall.core.ReportTargetKind

/**
 * A community's report queue (decision 0066), for its owner and moderators, oldest first: what was reported, as
 * a card, and why. Each report hides or removes what it names, with a reason that is logged, or is closed
 * without acting; the reason is required either way.
 */
class ReportsViewModel(
    private val communityId: String,
    private val social: Social,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {
    data class State(
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

    /** What a moderator may do with a report. */
    enum class Verb { Hide, Remove, Dismiss }

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    private var failed: (() -> Unit)? = null

    init {
        load()
    }

    fun load() {
        perform(::load) { reload() }
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

    /** Acts on the report: hides or removes what it names, or closes it. The queue is then asked for again. */
    fun act(
        report: Report,
        verb: Verb,
    ) {
        val reason =
            _state.value.reasons[report.reportId]
                ?.trim()
                .orEmpty()
        if (reason.isEmpty()) return
        val action = if (verb == Verb.Dismiss) null else report.action(verb) ?: return
        perform({ act(report, verb) }) {
            if (action == null) {
                social.closeReport(report.reportId, reason)
            } else {
                social.moderate(communityId, action, report.target.id, reason, report.reportId)
            }
            _state.update { it.copy(reasons = it.reasons - report.reportId) }
            reload()
            _state.update { it.copy(done = true) }
        }
    }

    fun retry() {
        failed?.invoke()
    }

    private fun reload() {
        val reports = social.communityReports(communityId, null, PAGE).reports
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

/** What hides or removes the post or comment [this] names; a community or an account is not moderated here. */
fun Report.action(verb: ReportsViewModel.Verb): ModerationAction? =
    when (target.kind) {
        ReportTargetKind.POST ->
            when (verb) {
                ReportsViewModel.Verb.Hide -> ModerationAction.HIDE_POST
                ReportsViewModel.Verb.Remove -> ModerationAction.REMOVE_POST
                ReportsViewModel.Verb.Dismiss -> null
            }
        ReportTargetKind.COMMENT ->
            when (verb) {
                ReportsViewModel.Verb.Hide -> ModerationAction.HIDE_COMMENT
                ReportsViewModel.Verb.Remove -> ModerationAction.REMOVE_COMMENT
                ReportsViewModel.Verb.Dismiss -> null
            }
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
