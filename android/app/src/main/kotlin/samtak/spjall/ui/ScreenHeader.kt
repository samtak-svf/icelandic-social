package samtak.spjall.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/**
 * A tab's cream band (0053): its name in capitals under the status bar, an optional action, and at the end the
 * notifications bell with its count (0109) when the shell provides one. Every tab shares it, so every tab starts the
 * same way and the bell sits in the same place on each.
 */
@Composable
fun ScreenHeader(
    title: String,
    action: (@Composable RowScope.() -> Unit)? = null,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .background(Palette.bg)
                .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top))
                // As tall as the list's band, whose round button keeps a 48dp touch target, so the two tabs line up.
                .heightIn(min = HEADER_HEIGHT.dp)
                .padding(start = 20.dp, end = 8.dp, top = 4.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = title.capitals(),
            style = Type.screenTitle,
            color = Palette.fg,
            modifier = Modifier.weight(1f).semantics { heading() },
        )
        action?.invoke(this)
        LocalBell.current?.let { BellButton(it) }
    }
}

private const val HEADER_HEIGHT = 56
