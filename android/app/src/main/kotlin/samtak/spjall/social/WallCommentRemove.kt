package samtak.spjall.social

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import samtak.spjall.brand.R
import samtak.spjall.ui.CancelButton
import samtak.spjall.ui.Palette

/** The longest reason the core takes (0115). */
internal const val REMOVE_REASON_MAX = 500

/** Whether a reason can be sent: not blank, and within what the core takes. */
internal fun removeReasonOk(reason: String) = reason.isNotBlank() && reason.length <= REMOVE_REASON_MAX

/** Asks the wall's owner why a comment is removed; the one who wrote it reads the reason (0115). */
@Composable
internal fun RemoveCommentDialog(
    onRemove: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var reason by rememberSaveable { mutableStateOf("") }
    val ready = removeReasonOk(reason)
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Palette.surface,
        title = { Text(stringResource(R.string.wall_comment_remove)) },
        text = {
            Column {
                Text(stringResource(R.string.wall_comment_remove_confirm))
                OutlinedTextField(
                    value = reason,
                    onValueChange = { reason = it },
                    label = { Text(stringResource(R.string.wall_comment_remove_reason)) },
                    modifier = Modifier.fillMaxWidth().testTag("remove-reason"),
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onRemove(reason.trim()) },
                enabled = ready,
                modifier = Modifier.testTag("remove-send"),
            ) { Text(stringResource(R.string.wall_comment_remove)) }
        },
        dismissButton = { CancelButton(onClick = onDismiss) },
    )
}
