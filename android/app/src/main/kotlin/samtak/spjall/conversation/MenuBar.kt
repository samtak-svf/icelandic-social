package samtak.spjall.conversation

import androidx.annotation.StringRes
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.Palette

/** The bar's slots, and what its "more" slot opens when they do not all fit (0072). */
internal data class MenuBar(
    val slots: List<MenuAction>,
    val more: List<MenuAction>,
)

/**
 * Fills the bar at the foot of the screen: reply, copy and delete first, then the rest while four fit.
 * With more than four, the fourth slot is "more" and holds the rest; delete is never behind it (0072).
 */
internal fun barActions(all: List<MenuAction>): MenuBar {
    val first = all.filter { it.kind in FIRST }.sortedBy { FIRST.indexOf(it.kind) }
    val ordered = first + all.filter { it.kind !in FIRST }
    return if (ordered.size <= BAR_SLOTS) {
        MenuBar(ordered, emptyList())
    } else {
        MenuBar(ordered.take(BAR_SLOTS - 1), ordered.drop(BAR_SLOTS - 1))
    }
}

/** The actions as a full-width bar above the navigation bar, each its icon over its word (0072). */
@Composable
internal fun ActionBar(
    bar: MenuBar,
    onPick: (MenuAction) -> Unit,
    onMore: () -> Unit,
) {
    Surface(color = Palette.surface, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom))) {
            HorizontalDivider(color = Palette.border)
            Row(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                bar.slots.forEach { action -> Slot(action.label, action) { onPick(action) } }
                if (bar.more.isNotEmpty()) Slot(R.string.more, null, onMore)
            }
        }
    }
}

@Composable
private fun RowScope.Slot(
    @StringRes label: Int,
    action: MenuAction?,
    onClick: () -> Unit,
) {
    val tint = if (action?.danger == true) Palette.danger else Palette.fg
    Column(
        modifier =
            Modifier
                .weight(1f)
                .heightIn(min = SLOT_HEIGHT.dp)
                .clickable(role = Role.Button, onClick = onClick)
                .padding(vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp, Alignment.CenterVertically),
    ) {
        Icon(action?.icon ?: AppIcons.More, contentDescription = null, tint = tint, modifier = Modifier.size(24.dp))
        Text(
            text = stringResource(label),
            style = MaterialTheme.typography.labelMedium,
            color = tint,
            textAlign = TextAlign.Center,
            maxLines = 1,
        )
    }
}

/** What did not fit in the bar, as rows of icon and words (0054, 0072). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun MoreSheet(
    actions: List<MenuAction>,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Palette.surface) {
        Column(modifier = Modifier.padding(bottom = 16.dp)) {
            actions.forEach { action ->
                val tint = if (action.danger) Palette.danger else Palette.fg
                Row(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .clickable(role = Role.Button) {
                                onDismiss()
                                action.act()
                            }.heightIn(min = 56.dp)
                            .padding(horizontal = 24.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    Icon(action.icon, contentDescription = null, tint = tint, modifier = Modifier.size(24.dp))
                    Text(stringResource(action.label), style = MaterialTheme.typography.bodyLarge, color = tint)
                }
            }
        }
    }
}

private val FIRST = listOf(MenuKind.Reply, MenuKind.Copy, MenuKind.Delete)
private const val BAR_SLOTS = 4
private const val SLOT_HEIGHT = 64
