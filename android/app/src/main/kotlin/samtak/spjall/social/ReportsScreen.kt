package samtak.spjall.social

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.Card
import samtak.spjall.core.Report
import samtak.spjall.core.ReportState
import samtak.spjall.me.Confirm
import samtak.spjall.ui.Palette
import samtak.spjall.ui.ProblemCard
import samtak.spjall.ui.listStamp

/**
 * "Tilkynnt efni": a community's open or closed reports, each with what it names and the moderator's answers to
 * it and to its author. A ban asks first.
 */
@Composable
fun ReportsScreen(
    state: ReportsViewModel.State,
    actions: ReportsActions,
) {
    // The report whose author a ban is asked for, until it is confirmed or cancelled.
    var banning by remember { mutableStateOf<Report?>(null) }
    Surface(modifier = Modifier.fillMaxSize(), color = Palette.bg, contentColor = Palette.fg) {
        Column(modifier = Modifier.windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal))) {
            SubHeader(stringResource(R.string.moderation_queue), actions::back)
            if (state.busy) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            LazyColumn(
                modifier = Modifier.weight(1f).imePadding(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                item(key = "showing") { Showing(state.showing, actions::show) }
                state.problem?.let { problem -> item(key = "problem") { ProblemCard(problem) { actions.retry() } } }
                if (state.done) item(key = "done") { Muted(stringResource(R.string.moderation_done)) }
                if (state.loaded && state.problem == null && state.reports.isEmpty()) {
                    item(key = "empty") { Muted(stringResource(EMPTY.getValue(state.showing))) }
                }
                items(state.reports, key = { it.reportId }) { report ->
                    ReportCard(
                        report = report,
                        card = state.cards[report.target.id],
                        reason = state.reasons[report.reportId].orEmpty(),
                        busy = state.busy,
                        actions = actions,
                        onBan = { banning = report },
                    )
                }
            }
        }
    }
    banning?.let { report ->
        Confirm(
            text = stringResource(R.string.moderation_ban_confirm),
            confirm = stringResource(R.string.moderation_ban),
            onConfirm = {
                banning = null
                actions.act(report, ReportsViewModel.Verb.Ban)
            },
            onDismiss = { banning = null },
        )
    }
}

@Composable
private fun ReportCard(
    report: Report,
    card: Card?,
    reason: String,
    busy: Boolean,
    actions: ReportsActions,
    onBan: () -> Unit,
) {
    val reasonLabel = REASONS.firstOrNull { it.first == report.reason }?.second ?: R.string.report_reason_other
    SocialCard {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                text = stringResource(reasonLabel),
                style = MaterialTheme.typography.titleSmall,
                modifier = Modifier.weight(1f),
            )
            Text(
                text = listStamp(report.createdAt),
                style = MaterialTheme.typography.bodySmall,
                color = Palette.mutedFg,
            )
        }
        if (report.note.isNotBlank()) Text(text = report.note, style = MaterialTheme.typography.bodyMedium)
        Excerpt(card)
        OutlinedTextField(
            value = reason,
            onValueChange = { actions.reason(report.reportId, it) },
            label = { Text(stringResource(R.string.report_reason)) },
            modifier = Modifier.fillMaxWidth(),
        )
        val ready = !busy && reason.isNotBlank()
        val open = report.state == ReportState.OPEN
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (report.action(ReportsViewModel.Verb.Hide) != null) {
                Verb(R.string.moderation_hide, ready) { actions.act(report, ReportsViewModel.Verb.Hide) }
                Button(
                    onClick = { actions.act(report, ReportsViewModel.Verb.Remove) },
                    enabled = ready,
                    colors =
                        ButtonDefaults.buttonColors(
                            containerColor = Palette.danger,
                            contentColor = Palette.dangerFg,
                        ),
                    modifier = Modifier.heightIn(min = 44.dp),
                ) { Text(stringResource(R.string.moderation_remove)) }
                // A closed report's content may be hidden or removed; the card does not say, so restoring is offered.
                if (!open) {
                    Verb(
                        R.string.moderation_restore,
                        ready,
                    ) { actions.act(report, ReportsViewModel.Verb.Restore) }
                }
            }
            if (open) Verb(R.string.moderation_dismiss, ready) { actions.act(report, ReportsViewModel.Verb.Dismiss) }
        }
        if (report.member() != null) AuthorVerbs(report, ready, actions, onBan)
    }
}

/** What may be done to the author of what a report names: mute, unmute, ban (asked first) or unban. */
@Composable
private fun AuthorVerbs(
    report: Report,
    ready: Boolean,
    actions: ReportsActions,
    onBan: () -> Unit,
) {
    Text(text = stringResource(R.string.moderation_member), style = MaterialTheme.typography.titleSmall)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        MuteVerb(ready) { actions.mute(report, it) }
        Verb(R.string.moderation_unmute, ready) { actions.act(report, ReportsViewModel.Verb.Unmute) }
        Verb(R.string.moderation_ban, ready, onBan)
        Verb(R.string.moderation_unban, ready) { actions.act(report, ReportsViewModel.Verb.Unban) }
    }
}

/** "Þagga niður", which asks for how long: a day, a week or 30 days (decision 0063). */
@Composable
private fun MuteVerb(
    enabled: Boolean,
    onMute: (ReportsViewModel.MutePeriod) -> Unit,
) {
    var choosing by remember { mutableStateOf(false) }
    Box {
        Verb(R.string.moderation_mute, enabled) { choosing = true }
        DropdownMenu(expanded = choosing, onDismissRequest = { choosing = false }, containerColor = Palette.surface) {
            Text(
                text = stringResource(R.string.moderation_mute_for),
                style = MaterialTheme.typography.titleSmall,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            )
            MUTE_PERIODS.forEach { (period, label) ->
                DropdownMenuItem(
                    text = { Text(stringResource(label)) },
                    onClick = {
                        choosing = false
                        onMute(period)
                    },
                )
            }
        }
    }
}

private val MUTE_PERIODS =
    listOf(
        ReportsViewModel.MutePeriod.Day to R.string.moderation_mute_day,
        ReportsViewModel.MutePeriod.Week to R.string.moderation_mute_week,
        ReportsViewModel.MutePeriod.Month to R.string.moderation_mute_month,
    )

/** The switch between the open reports and the closed ones. */
@Composable
private fun Showing(
    showing: ReportState,
    onShow: (ReportState) -> Unit,
) {
    Choices(
        options =
            listOf(
                ReportState.OPEN to stringResource(R.string.moderation_open),
                ReportState.CLOSED to stringResource(R.string.moderation_closed),
            ),
        selected = showing,
        onSelect = onShow,
    )
}

/** What an empty list says, for the reports shown. */
private val EMPTY =
    mapOf(
        ReportState.OPEN to R.string.moderation_queue_empty,
        ReportState.CLOSED to R.string.moderation_closed_empty,
    )

/** One of a moderator's answers, as an outlined button. */
@Composable
private fun Verb(
    label: Int,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    OutlinedButton(onClick = onClick, enabled = enabled, modifier = Modifier.heightIn(min = 44.dp)) {
        Text(stringResource(label))
    }
}

/** The reported post or comment, as its card shows it: who wrote it and the start of it. */
@Composable
private fun Excerpt(card: Card?) {
    val (author, excerpt) =
        when (card) {
            is Card.Post -> card.author to card.excerpt
            is Card.Comment -> card.author to card.excerpt
            else -> return
        }
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .background(Palette.secondarySubtle, RoundedCornerShape(10.dp))
                .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(text = author.shownName(), style = MaterialTheme.typography.titleSmall)
        Text(text = excerpt, style = MaterialTheme.typography.bodyMedium)
    }
}
