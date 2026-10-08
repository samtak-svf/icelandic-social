package samtak.spjall.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

/** One tab: its icon, its name, and whether it is the one showing. */
class Tab(
    val icon: ImageVector,
    val label: String,
    val selected: Boolean,
    val onClick: () -> Unit,
)

/**
 * The bottom bar (1a): a white strip under a hairline, each tab a line icon
 * over its name in small capitals, red when it is the one showing.
 */
@Composable
fun TabBar(tabs: List<Tab>) {
    Column(modifier = Modifier.fillMaxWidth().background(Palette.surface)) {
        HorizontalDivider(color = Palette.border)
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .windowInsetsPadding(WindowInsets.navigationBars)
                    .selectableGroup(),
        ) {
            tabs.forEach { tab ->
                val tint = if (tab.selected) Palette.primary else Palette.mutedFg
                Column(
                    modifier =
                        Modifier
                            .weight(1f)
                            .heightIn(min = HEIGHT.dp)
                            .selectable(selected = tab.selected, role = Role.Tab, onClick = tab.onClick)
                            .padding(top = 10.dp, bottom = 8.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(3.dp),
                ) {
                    Icon(tab.icon, contentDescription = null, tint = tint, modifier = Modifier.size(ICON.dp))
                    Text(text = tab.label.capitals(), style = LABEL, color = tint)
                }
            }
        }
    }
}

private const val HEIGHT = 56
private const val ICON = 20

private val LABEL =
    TextStyle(fontFamily = SansFamily, fontWeight = FontWeight.Black, fontSize = 9.5.sp, letterSpacing = 0.06.em)
