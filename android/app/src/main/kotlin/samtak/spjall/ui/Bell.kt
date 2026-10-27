package samtak.spjall.ui

import androidx.compose.foundation.layout.size
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp

/**
 * The notifications bell (decision 0109): [label] is what it is read out as, [unread] the count drawn on it and
 * [unreadDescription] that count read out, [selected] while the notifications screen is the one showing.
 */
class Bell(
    val label: String,
    val unread: Long,
    val unreadDescription: String?,
    val selected: Boolean,
    val onClick: () -> Unit,
)

/**
 * The bell every tab's header draws at its end, provided once by the navigation shell; none (a preview, a test of a
 * single screen) draws no bell.
 */
val LocalBell = compositionLocalOf<Bell?> { null }

/** The bell at the end of a tab's header, with its count, red while its screen is the one showing. */
@Composable
fun BellButton(bell: Bell) {
    IconButton(
        onClick = bell.onClick,
        modifier =
            Modifier.testTag(BELL).semantics(mergeDescendants = true) {
                role = Role.Button
                contentDescription = bell.label
                selected = bell.selected
                bell.unreadDescription?.let { stateDescription = it }
            },
    ) {
        BadgedBox(
            badge = {
                if (bell.unread > 0) {
                    Badge(containerColor = Palette.primary, contentColor = Palette.primaryFg) {
                        Text(if (bell.unread > MAX) "$MAX+" else "${bell.unread}")
                    }
                }
            },
        ) {
            Icon(
                AppIcons.Bell,
                contentDescription = null,
                tint = if (bell.selected) Palette.primary else Palette.fg,
                modifier = Modifier.size(ICON.dp),
            )
        }
    }
}

/** The bell's test tag. */
const val BELL = "bell"

private const val ICON = 22
private const val MAX = 99
