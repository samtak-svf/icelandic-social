package samtak.spjall.social

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import samtak.spjall.core.WallAudience

/** Who may read a new wall post: one chip per audience, the chosen one marked. */
@Composable
internal fun AudienceChips(
    selected: WallAudience,
    onSelect: (WallAudience) -> Unit,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        WallAudience.entries.forEach { audience ->
            FilterChip(
                selected = selected == audience,
                onClick = { onSelect(audience) },
                label = { Text(stringResource(audienceLabel(audience))) },
                modifier = Modifier.heightIn(min = 48.dp).testTag("compose-audience-${audience.name}"),
            )
        }
    }
}
