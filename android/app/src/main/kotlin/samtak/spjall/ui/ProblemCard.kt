package samtak.spjall.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import samtak.spjall.account.Problem
import samtak.spjall.brand.R

/** What went wrong, and a way to try again when trying again can help. */
@Composable
fun ProblemCard(
    problem: Problem,
    onRetry: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                text =
                    stringResource(
                        when (problem) {
                            Problem.Unreachable -> R.string.error_unreachable
                            Problem.InviteRequired -> R.string.invite_required
                            Problem.TooLarge -> R.string.media_too_large
                            Problem.Generic -> R.string.error_generic
                        },
                    ),
                color = MaterialTheme.colorScheme.onSurface,
            )
            // Without an invite, trying again cannot work; a link can. Nor can a smaller file be.
            if (problem != Problem.InviteRequired && problem != Problem.TooLarge) {
                TextButton(onClick = onRetry) { Text(stringResource(R.string.try_again)) }
            }
        }
    }
}
