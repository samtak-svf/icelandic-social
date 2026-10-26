package samtak.spjall.conversation

import android.content.Context
import android.content.res.Configuration
import android.view.ContextThemeWrapper
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.rememberNestedScrollInteropConnection
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.emoji2.emojipicker.EmojiPickerView
import samtak.spjall.brand.R
import samtak.spjall.ui.Palette
import java.util.Locale

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
        EmojiPickerContent(onPick = onPick, onDismiss = onDismiss)
    }
}

/**
 * The sheet's body. [insets] is the system area the grid must end above: the sheet draws edge to
 * edge, so without it the last row sits under three-button navigation (#295).
 */
@Composable
internal fun EmojiPickerContent(
    onPick: (String) -> Unit,
    onDismiss: () -> Unit,
    insets: WindowInsets = WindowInsets.navigationBars,
) {
    val base = LocalContext.current
    val icelandic = remember(base) { icelandicContext(base) }
    Column(Modifier.windowInsetsPadding(insets)) {
        Text(
            text = stringResource(R.string.react_any),
            style = MaterialTheme.typography.titleMedium,
            color = Palette.fg,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp).semantics { heading() },
        )
        AndroidView(
            factory = {
                EmojiPickerView(icelandic).apply {
                    setOnEmojiPickedListener {
                        onDismiss()
                        onPick(it.emoji)
                    }
                }
            },
            // The sheet drags only when the grid is at its top.
            modifier =
                Modifier
                    .testTag("emoji-picker")
                    .fillMaxWidth()
                    .height(PICKER_HEIGHT.dp)
                    .nestedScroll(rememberNestedScrollInteropConnection()),
        )
    }
}

/**
 * The picker resolves its category headers against the context it is built from, and the library
 * ships Icelandic ones, but the app's Icelandic lives in default resources, so a device set to
 * another language would see English headers. Build the view from an Icelandic configuration.
 */
internal fun icelandicContext(base: Context): Context {
    val configuration =
        Configuration(base.resources.configuration).apply { setLocale(Locale.forLanguageTag("is")) }
    val localized = base.createConfigurationContext(configuration)
    return ContextThemeWrapper(localized, 0).apply { theme.setTo(base.theme) }
}

private const val PICKER_HEIGHT = 380
