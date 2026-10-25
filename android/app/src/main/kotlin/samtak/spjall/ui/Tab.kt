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
import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.NavigationRailItemDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

/**
 * One tab: its icon, its name, and whether it is the one showing. A [badge] is a count drawn on the icon, read
 * out as [badgeDescription].
 */
class Tab(
    val icon: ImageVector,
    val label: String,
    val selected: Boolean,
    val badge: Long = 0,
    val badgeDescription: String? = null,
    val onClick: () -> Unit,
)

/**
 * The bottom bar (1a): a white strip under a hairline, each tab a line icon
 * over its name in small capitals, red when it is the one showing.
 */
@Composable
fun TabBar(tabs: List<Tab>) {
    Column(modifier = Modifier.fillMaxWidth().background(Palette.surface).testTag(NAVIGATION_BAR)) {
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
                            .semantics { tab.badgeDescription?.let { stateDescription = it } }
                            .padding(top = 10.dp, bottom = 8.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(3.dp),
                ) {
                    TabIcon(tab, tint)
                    // One line always: at a large text size the name gets smaller, down to its size at the standard
                    // text size, and never breaks inside the word.
                    val scale = LocalDensity.current.fontScale
                    Text(
                        text = tab.label.capitals(),
                        style = LABEL,
                        color = tint,
                        maxLines = 1,
                        softWrap = false,
                        autoSize =
                            if (scale > 1f) {
                                TextAutoSize.StepBased((LABEL_SIZE / scale).sp, LABEL_SIZE.sp, 0.25.sp)
                            } else {
                                null
                            },
                    )
                }
            }
        }
    }
}

/**
 * The same tabs down the left edge (decision 0087), for a window of the medium size class and wider: the icon over
 * the name, the count on the icon, red when it is the one showing.
 */
@Composable
fun TabRail(tabs: List<Tab>) {
    NavigationRail(
        modifier = Modifier.testTag(NAVIGATION_RAIL).selectableGroup(),
        containerColor = Palette.surface,
        contentColor = Palette.fg,
    ) {
        tabs.forEach { tab ->
            NavigationRailItem(
                selected = tab.selected,
                onClick = tab.onClick,
                icon = { TabIcon(tab, if (tab.selected) Palette.primary else Palette.mutedFg) },
                label = { Text(tab.label.capitals(), style = LABEL, maxLines = 1, softWrap = false) },
                alwaysShowLabel = true,
                modifier = Modifier.semantics { tab.badgeDescription?.let { stateDescription = it } },
                colors =
                    NavigationRailItemDefaults.colors(
                        selectedTextColor = Palette.primary,
                        unselectedTextColor = Palette.mutedFg,
                        indicatorColor = Palette.border,
                    ),
            )
        }
    }
}

/** A tab's icon with its count drawn on it. */
@Composable
private fun TabIcon(
    tab: Tab,
    tint: Color,
) {
    BadgedBox(
        badge = {
            if (tab.badge > 0) {
                Badge(containerColor = Palette.primary, contentColor = Palette.primaryFg) {
                    Text(if (tab.badge > MAX) "$MAX+" else "${tab.badge}")
                }
            }
        },
    ) {
        Icon(tab.icon, contentDescription = null, tint = tint, modifier = Modifier.size(ICON.dp))
    }
}

/** The test tags of the two forms of the tabs. */
const val NAVIGATION_BAR = "navigation-bar"
const val NAVIGATION_RAIL = "navigation-rail"

private const val HEIGHT = 56
private const val ICON = 20
private const val MAX = 99
private const val LABEL_SIZE = 9.5f

private val LABEL =
    TextStyle(fontFamily = SansFamily, fontWeight = FontWeight.Black, fontSize = LABEL_SIZE.sp, letterSpacing = 0.06.em)
