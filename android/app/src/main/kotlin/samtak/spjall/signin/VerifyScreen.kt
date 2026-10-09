package samtak.spjall.signin

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.Palette
import samtak.spjall.ui.ProblemCard
import samtak.spjall.ui.Type
import samtak.spjall.ui.VerifiedMark

/**
 * What linking Kenni gives and keeps (decision 0033), and the button that
 * opens it. [SignInViewModel] runs the link, as it runs the browser.
 */
@Composable
fun VerifyScreen(
    state: SignInViewModel.State,
    onVerify: () -> Unit,
    onLater: () -> Unit,
    onRetry: () -> Unit,
) {
    Surface(modifier = Modifier.fillMaxSize(), color = Palette.bg, contentColor = Palette.fg) {
        Column(modifier = Modifier.safeDrawingPadding()) {
            IconButton(onClick = onLater, modifier = Modifier.padding(start = 4.dp)) {
                Icon(AppIcons.Back, contentDescription = stringResource(R.string.back), tint = Palette.fg)
            }
            Column(
                modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                VerifiedMark(size = SHIELD.dp)
                Text(
                    text = stringResource(R.string.verify_title),
                    style = Type.accountName,
                    modifier = Modifier.semantics { heading() },
                )
                Text(stringResource(R.string.verify_body), style = MaterialTheme.typography.bodyLarge)
                Point(R.string.verify_point_name)
                Point(R.string.verify_point_kennitala)
                Point(R.string.verify_point_optional)
            }
            Column(
                modifier = Modifier.padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                state.problem?.let { ProblemCard(it, onRetry) }
                if (state.busy) {
                    CircularProgressIndicator(modifier = Modifier.align(Alignment.CenterHorizontally))
                } else {
                    Button(
                        onClick = onVerify,
                        shape = RoundedCornerShape(PILL_RADIUS.dp),
                        modifier = Modifier.fillMaxWidth().heightIn(min = PILL.dp),
                    ) {
                        Text(stringResource(R.string.verify_action), style = MaterialTheme.typography.titleMedium)
                    }
                }
                TextButton(onClick = onLater, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.verify_later), color = Palette.fg)
                }
            }
        }
    }
}

@Composable
private fun Point(text: Int) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
        Icon(AppIcons.ShieldCheck, contentDescription = null, tint = Palette.primary, modifier = Modifier.size(20.dp))
        Text(stringResource(text), style = MaterialTheme.typography.bodyMedium)
        Spacer(Modifier.weight(1f, fill = false))
    }
}

private const val SHIELD = 64
