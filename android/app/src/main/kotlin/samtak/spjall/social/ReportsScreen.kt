package samtak.spjall.social

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.Card
import samtak.spjall.core.Report
import samtak.spjall.ui.Palette
import samtak.spjall.ui.ProblemCard
import samtak.spjall.ui.listStamp

/** "Tilkynnt efni": a community's open reports, each with what it names and the moderator's three answers. */
@Composable
fun ReportsScreen(
    state: ReportsViewModel.State,
    actions: ReportsActions,
) {
    Surface(modifier = Modifier.fillMaxSize(), color = Palette.bg, contentColor = Palette.fg) {
        Column(modifier = Modifier.windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal))) {
            SubHeader(stringResource(R.string.moderation_queue), actions::back)
            if (state.busy) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            LazyColumn(
                modifier = Modifier.weight(1f).imePadding(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                state.problem?.let { problem -> item(key = "problem") { ProblemCard(problem) { actions.retry() } } }
                if (state.done) item(key = "done") { Muted(stringResource(R.string.moderation_done)) }
                if (state.loaded && state.problem == null && state.reports.isEmpty()) {
                    item(key = "empty") { Muted(stringResource(R.string.moderation_queue_empty)) }
                }
                items(state.reports, key = { it.reportId }) { report ->
                    ReportCard(
                        report = report,
                        card = state.cards[report.target.id],
                        reason = state.reasons[report.reportId].orEmpty(),
                        busy = state.busy,
                        actions = actions,
                    )
                }
            }
        }
    }
}

@Composable
private fun ReportCard(
    report: Report,
    card: Card?,
    reason: String,
    busy: Boolean,
    actions: ReportsActions,
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
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (report.action(ReportsViewModel.Verb.Hide) != null) {
                OutlinedButton(
                    onClick = { actions.act(report, ReportsViewModel.Verb.Hide) },
                    enabled = ready,
                    modifier = Modifier.heightIn(min = 44.dp),
                ) { Text(stringResource(R.string.moderation_hide)) }
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
            }
            OutlinedButton(
                onClick = { actions.act(report, ReportsViewModel.Verb.Dismiss) },
                enabled = ready,
                modifier = Modifier.heightIn(min = 44.dp),
            ) { Text(stringResource(R.string.moderation_dismiss)) }
        }
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
