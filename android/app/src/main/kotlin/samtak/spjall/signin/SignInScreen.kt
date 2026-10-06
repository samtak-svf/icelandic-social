package samtak.spjall.signin

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.signin.SignInViewModel.Invite
import samtak.spjall.ui.ProblemCard

/** The way in: who invited the person, if anyone, and the Kenni button. */
@Composable
fun SignInScreen(
    state: SignInViewModel.State,
    onSignIn: () -> Unit,
    onRetry: () -> Unit,
) {
    Surface(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier.safeDrawingPadding().padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                text = stringResource(R.string.app_name),
                style = MaterialTheme.typography.displaySmall,
                color = MaterialTheme.colorScheme.primary,
            )
            when (val invite = state.invite) {
                Invite.None, Invite.Loading -> Unit
                is Invite.From ->
                    Text(
                        text =
                            invite.name?.let { stringResource(R.string.link_invited_by, it) }
                                ?: stringResource(R.string.link_invited),
                        style = MaterialTheme.typography.titleMedium,
                    )
                Invite.Expired ->
                    Text(
                        text = stringResource(R.string.link_expired),
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.error,
                    )
            }
            Spacer(Modifier.weight(1f))
            state.problem?.let { problem -> ProblemCard(problem, onRetry) }
            if (state.busy) {
                CircularProgressIndicator()
            } else {
                Button(onClick = onSignIn, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.sign_in))
                }
            }
            Text(text = stringResource(R.string.sign_in_hint), style = MaterialTheme.typography.bodyMedium)
            Text(
                text = stringResource(R.string.residency_claim),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
