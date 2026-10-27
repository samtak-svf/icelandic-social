package samtak.spjall.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
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
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.NavigationRailItemDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

/**
 * One tab: its icon, its name, and whether it is the one showing. No tab carries a count: the notifications count
 * is on the bell in the header (decision 0109).
 */
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
    Column(modifier = Modifier.fillMaxWidth().background(Palette.surface).testTag(NAVIGATION_BAR)) {
        HorizontalDivider(color = Palette.border)
        BoxWithConstraints {
            // One line always, and one size for every name: at a large text size they all get smaller together, down
            // to their size at the standard text size, until the longest fits its column. Never a break inside a word.
            val size = sharedLabelSize(tabs.map { it.label.capitals() }, maxWidth / tabs.size)
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
                        TabIcon(tab, tint)
                        Text(
                            text = tab.label.capitals(),
                            style = LABEL.copy(fontSize = size),
                            color = tint,
                            maxLines = 1,
                            softWrap = false,
                        )
                    }
                }
            }
        }
    }
}

/**
 * The font size for every name in the bar: the largest on a 0.25.sp step, from the size at the standard text size
 * up to [LABEL_SIZE], at which each of [names] fits one line in a column [column] wide. The smallest when none does.
 */
@Composable
private fun sharedLabelSize(
    names: List<String>,
    column: Dp,
): TextUnit {
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val widest = with(density) { column.roundToPx() }
    val smallest = LABEL_SIZE / density.fontScale
    return remember(names, widest, density.fontScale, measurer) {
        var size = LABEL_SIZE
        while (size > smallest && !names.all { fits(measurer, it, size.sp, widest) }) size -= STEP
        size.coerceAtLeast(smallest).sp
    }
}

private fun fits(
    measurer: TextMeasurer,
    name: String,
    size: TextUnit,
    width: Int,
): Boolean =
    measurer
        .measure(name, LABEL.copy(fontSize = size), maxLines = 1, softWrap = false)
        .size.width <= width

/**
 * The same tabs down the left edge (decision 0087), for a window of the medium size class and wider: the icon over
 * the name, red when it is the one showing.
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

/** A tab's icon. */
@Composable
private fun TabIcon(
    tab: Tab,
    tint: Color,
) {
    Icon(tab.icon, contentDescription = null, tint = tint, modifier = Modifier.size(ICON.dp))
}

/** The test tags of the two forms of the tabs. */
const val NAVIGATION_BAR = "navigation-bar"
const val NAVIGATION_RAIL = "navigation-rail"

private const val HEIGHT = 56
private const val ICON = 20
private const val LABEL_SIZE = 9.5f
private const val STEP = 0.25f

private val LABEL =
    TextStyle(fontFamily = SansFamily, fontWeight = FontWeight.Black, fontSize = LABEL_SIZE.sp, letterSpacing = 0.06.em)
