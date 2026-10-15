package samtak.spjall.conversation

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.ui.Type

/** A stored row the core cannot read: one fixed line and its code to quote (decision 0051). */
@Composable
internal fun Unreadable(
    code: String,
    foreground: Color,
) {
    Column {
        Text(
            text = stringResource(R.string.item_unreadable),
            style = Type.bubble,
            fontStyle = FontStyle.Italic,
            color = foreground,
        )
        SelectionContainer(modifier = Modifier.padding(top = 4.dp)) {
            Text(text = stringResource(R.string.problem_local_code, code), style = Type.meta, color = foreground)
        }
    }
}
