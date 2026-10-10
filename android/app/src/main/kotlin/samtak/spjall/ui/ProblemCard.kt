package samtak.spjall.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
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
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = Palette.secondarySubtle, contentColor = Palette.fg),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                text =
                    stringResource(
                        when (problem) {
                            Problem.Unreachable -> R.string.error_unreachable
                            is Problem.IdentityTaken -> R.string.identity_taken
                            Problem.TooLarge -> R.string.media_too_large
                            is Problem.Generic -> R.string.error_generic
                        },
                    ),
            )
            // A refusal names the server's request id (decision 0037), selectable so a tester can quote it.
            problem.requestId?.let { id ->
                SelectionContainer(modifier = Modifier.padding(top = 4.dp)) {
                    Text(
                        text = stringResource(R.string.problem_request_id, id),
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
            // The same kennitala stays on the other account, and the same file stays too large.
            if (problem !is Problem.IdentityTaken && problem != Problem.TooLarge) {
                TextButton(onClick = onRetry) { Text(stringResource(R.string.try_again)) }
            }
        }
    }
}
