package samtak.spjall.conversation

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.rememberNestedScrollInteropConnection
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.emoji2.emojipicker.EmojiPickerView
import samtak.spjall.brand.R
import samtak.spjall.ui.Palette

/**
 * Every emoji, for a reaction the row above the message does not offer (0072): the system's own
 * picker, with its categories and the ones this device used last. It reads nothing from the network.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun EmojiPickerSheet(
    onPick: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Palette.surface) {
        Column {
            Text(
                text = stringResource(R.string.react_any),
                style = MaterialTheme.typography.titleMedium,
                color = Palette.fg,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp).semantics { heading() },
            )
            AndroidView(
                factory = { context ->
                    EmojiPickerView(context).apply {
                        setOnEmojiPickedListener {
                            onDismiss()
                            onPick(it.emoji)
                        }
                    }
                },
                // The sheet drags only when the grid is at its top.
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .height(PICKER_HEIGHT.dp)
                        .nestedScroll(rememberNestedScrollInteropConnection()),
            )
        }
    }
}

private const val PICKER_HEIGHT = 380
