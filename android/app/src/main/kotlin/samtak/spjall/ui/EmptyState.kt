package samtak.spjall.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

/**
 * What every empty screen shows (decision 0043): an icon, one line and at
 * most one button, [action] which does [onAction]. The icon only decorates;
 * the line is what is read out.
 */
@Composable
fun EmptyState(
    icon: ImageVector,
    text: String,
    modifier: Modifier = Modifier,
    action: String? = null,
    onAction: () -> Unit = {},
) {
    Column(
        modifier = modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 28.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(icon, contentDescription = null, tint = Palette.mutedFg, modifier = Modifier.size(ICON.dp))
        Text(
            text = text,
            style = MaterialTheme.typography.bodyLarge,
            color = Palette.mutedFg,
            textAlign = TextAlign.Center,
        )
        if (action != null) {
            Button(onClick = onAction, modifier = Modifier.heightIn(min = BUTTON.dp)) { Text(action) }
        }
    }
}

private const val ICON = 32
private const val BUTTON = 48
