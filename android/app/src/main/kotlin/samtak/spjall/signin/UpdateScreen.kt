package samtak.spjall.signin

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.ui.Palette
import samtak.spjall.ui.Type

/**
 * All the app shows once the server no longer serves this build (decision
 * 0030): nothing else would work, so it says so and leads to the store.
 */
@Composable
fun UpdateScreen(onUpdate: () -> Unit) {
    Surface(modifier = Modifier.fillMaxSize(), color = Palette.bg) {
        Column(
            modifier = Modifier.safeDrawingPadding().padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                text = stringResource(R.string.update_required_title),
                style = Type.screenTitle,
                color = Palette.fg,
                modifier = Modifier.semantics { heading() },
            )
            Text(
                text = stringResource(R.string.update_required_body),
                style = MaterialTheme.typography.bodyLarge,
                color = Palette.fg,
            )
            Spacer(Modifier.weight(1f))
            Button(
                onClick = onUpdate,
                shape = RoundedCornerShape(PILL_RADIUS.dp),
                modifier = Modifier.fillMaxWidth().heightIn(min = PILL.dp),
            ) {
                Text(stringResource(R.string.update_required_action), style = MaterialTheme.typography.titleMedium)
            }
        }
    }
}
