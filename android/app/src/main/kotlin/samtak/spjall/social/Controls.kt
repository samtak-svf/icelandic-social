package samtak.spjall.social

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.BrandTokens.Radius
import samtak.spjall.brand.R
import samtak.spjall.me.Confirm
import samtak.spjall.ui.Palette

/** A switch between ways of showing one list, as pills like the reactions: the one shown is pressed. */
@Composable
fun <T> Choices(
    options: List<Pair<T, String>>,
    selected: T,
    onSelect: (T) -> Unit,
) {
    // Side by side while they fit; at a large text size the next goes to a new line instead of cutting its word.
    FlowRow(
        modifier = Modifier.selectableGroup(),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        options.forEach { (value, label) ->
            val on = value == selected
            Row(
                modifier =
                    Modifier
                        .heightIn(min = CHOICE_HEIGHT.dp)
                        .background(
                            if (on) Palette.primarySubtle else Palette.surface,
                            RoundedCornerShape(Radius.FIELD_DP.dp),
                        ).border(
                            BorderStroke(1.dp, if (on) Palette.primary else Palette.border),
                            RoundedCornerShape(Radius.FIELD_DP.dp),
                        ).selectable(selected = on, role = Role.Tab) { onSelect(value) }
                        .padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(text = label, style = MaterialTheme.typography.labelLarge)
            }
        }
    }
}

/** Asks whether to delete, in [text]'s words; "Eyða" deletes, either answer closes it. */
@Composable
fun ConfirmDelete(
    text: Int,
    onDelete: () -> Unit,
    onDismiss: () -> Unit,
) {
    Confirm(
        text = stringResource(text),
        confirm = stringResource(R.string.delete),
        onConfirm = {
            onDismiss()
            onDelete()
        },
        onDismiss = onDismiss,
    )
}

private const val CHOICE_HEIGHT = 44
