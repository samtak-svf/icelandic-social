package samtak.spjall.social

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.ReportReason
import samtak.spjall.ui.Palette
import samtak.spjall.ui.capitals
import samtak.spjall.ui.fitsIn

/**
 * Reporting a post or a comment (decision 0066): a reason, an optional note, and send. The moderators are never
 * told who reported it.
 */
@Composable
fun ReportDialog(
    onSend: (ReportReason, String) -> Unit,
    onDismiss: () -> Unit,
) {
    var reason by rememberSaveable { mutableStateOf<ReportReason?>(null) }
    var note by rememberSaveable { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.report_title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    text = stringResource(R.string.report_reason).capitals(),
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Bold,
                    color = Palette.mutedFg,
                )
                Column(modifier = Modifier.selectableGroup()) {
                    REASONS.forEach { (value, label) ->
                        Row(
                            modifier =
                                Modifier
                                    .fillMaxWidth()
                                    .heightIn(min = TOUCH.dp)
                                    .selectable(selected = reason == value, role = Role.RadioButton) { reason = value },
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            RadioButton(selected = reason == value, onClick = null)
                            Text(stringResource(label))
                        }
                    }
                }
                OutlinedTextField(
                    value = note,
                    onValueChange = { if (it.fitsIn(NOTE_LIMIT)) note = it },
                    label = { Text(stringResource(R.string.report_note)) },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            TextButton(onClick = { reason?.let { onSend(it, note) } }, enabled = reason != null) {
                Text(stringResource(R.string.report_send))
            }
        },
        dismissButton = { samtak.spjall.ui.CancelButton(onDismiss) },
    )
}

/** The reasons a report can give, in the order the web lists them. */
val REASONS =
    listOf(
        ReportReason.UNLAWFUL to R.string.report_reason_unlawful,
        ReportReason.HARASSMENT to R.string.report_reason_harassment,
        ReportReason.SPAM to R.string.report_reason_spam,
        ReportReason.OTHER to R.string.report_reason_other,
    )
