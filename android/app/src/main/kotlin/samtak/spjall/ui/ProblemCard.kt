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
            Text(text = stringResource(problem.message()))
            // A refusal names the server's request id (decision 0037), selectable so a tester can quote it.
            problem.requestId?.let { id ->
                SelectionContainer(modifier = Modifier.padding(top = 4.dp)) {
                    Text(
                        text = stringResource(R.string.problem_request_id, id),
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
            // A failure no server answered names the core's code for it (decision 0049).
            problem.code?.let { code ->
                SelectionContainer(modifier = Modifier.padding(top = 4.dp)) {
                    Text(
                        text = stringResource(R.string.problem_local_code, code),
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
            // The same kennitala stays on the other account, and the same file stays too large. A
            // location is looked for again from the attach menu, so the card offers nothing.
            if (problem.canRetry()) {
                TextButton(onClick = onRetry) { Text(stringResource(R.string.try_again)) }
            }
        }
    }
}

/** Problems trying again cannot help with, or that have their own way back. */
private val FINAL =
    setOf(
        Problem.TooLarge,
        Problem.LocationNotFound,
        Problem.LocationDenied,
        Problem.NotPermitted,
        Problem.NotFound,
        Problem.JoinDeclined,
        Problem.PollClosed,
        Problem.AnonymousOff,
        Problem.PinFull,
        Problem.GroupPhotoUnsupported,
    )

/** Whether the same call may work if asked again: not a refusal the server will repeat. */
private fun Problem.canRetry() = this !is Problem.IdentityTaken && this !in FINAL

@Suppress("CyclomaticComplexMethod") // One branch per problem, each a sentence of its own.
internal fun Problem.message(): Int =
    when (this) {
        Problem.Unreachable -> R.string.error_unreachable
        is Problem.IdentityTaken -> R.string.identity_taken
        Problem.TooLarge -> R.string.media_too_large
        Problem.LocationNotFound -> R.string.location_not_found
        Problem.LocationDenied -> R.string.location_denied
        Problem.NotPermitted -> R.string.problem_not_permitted
        Problem.NotFound -> R.string.problem_not_found
        Problem.JoinDeclined -> R.string.problem_join_declined
        Problem.PollClosed -> R.string.poll_closed_problem
        Problem.AnonymousOff -> R.string.problem_anonymous_off
        Problem.PinFull -> R.string.post_pin_full
        Problem.GroupPhotoUnsupported -> R.string.group_photo_unsupported
        Problem.GroupPhotoFailed -> R.string.group_photo_failed
        is Problem.Generic -> R.string.error_generic
    }
