package samtak.spjall.signin

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.SignInProvider
import samtak.spjall.signin.SignInViewModel.Invite
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.Palette
import samtak.spjall.ui.ProblemCard
import samtak.spjall.ui.Type
import samtak.spjall.ui.capitals

/**
 * The way in (decision 0033): who invited the person, if anyone, Google as the
 * main button, and Kenni under it for the accounts it made.
 */
@Composable
fun SignInScreen(
    state: SignInViewModel.State,
    onSignIn: (SignInProvider) -> Unit,
    onRetry: () -> Unit,
) {
    Surface(modifier = Modifier.fillMaxSize(), color = Palette.bg) {
        Column(
            modifier = Modifier.safeDrawingPadding().padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                text = stringResource(R.string.app_name).capitals(),
                style = Type.screenTitle,
                color = Palette.fg,
                modifier = Modifier.semantics { heading() },
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
                CircularProgressIndicator(modifier = Modifier.align(Alignment.CenterHorizontally))
            } else {
                GoogleButton { onSignIn(SignInProvider.GOOGLE) }
                TextButton(
                    onClick = { onSignIn(SignInProvider.KENNI) },
                    modifier = Modifier.fillMaxWidth().heightIn(min = TOUCH.dp),
                ) {
                    Text(stringResource(R.string.sign_in_kenni), color = Palette.fg)
                }
            }
            Text(text = stringResource(R.string.sign_in_hint), style = MaterialTheme.typography.bodyMedium)
            Text(
                text = stringResource(R.string.residency_claim),
                style = MaterialTheme.typography.bodySmall,
                color = Palette.mutedFg,
            )
        }
    }
}

/** White, outlined, with Google's "G": the shape Google's sign-in guidelines allow. */
@Composable
private fun GoogleButton(onClick: () -> Unit) {
    OutlinedButton(
        onClick = onClick,
        shape = RoundedCornerShape(PILL_RADIUS.dp),
        border = BorderStroke(1.dp, Palette.border),
        colors = ButtonDefaults.outlinedButtonColors(containerColor = Palette.surface, contentColor = Palette.fg),
        modifier = Modifier.fillMaxWidth().heightIn(min = PILL.dp),
    ) {
        Image(AppIcons.GoogleG, contentDescription = null, modifier = Modifier.size(G.dp))
        Spacer(Modifier.width(12.dp))
        Text(stringResource(R.string.sign_in_google), style = MaterialTheme.typography.titleMedium)
    }
}

/** The design's pill: as tall as a thumb, fully rounded. */
internal const val PILL = 52
internal const val PILL_RADIUS = 26
private const val TOUCH = 48
private const val G = 20
