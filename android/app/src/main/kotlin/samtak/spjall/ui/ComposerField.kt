package samtak.spjall.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** The rounded one-to-five-line field a message or a comment is written in, shared by both composers. */
@Composable
fun ComposerField(
    value: String,
    onChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val shape = RoundedCornerShape(FIELD_RADIUS.dp)
    BasicTextField(
        value = value,
        onValueChange = onChange,
        maxLines = COMPOSER_LINES,
        textStyle = FIELD.copy(color = Palette.fg),
        cursorBrush = SolidColor(Palette.fg),
        interactionSource = interaction,
        modifier =
            modifier
                .heightIn(min = FIELD_HEIGHT.dp)
                .background(if (focused) Palette.surface else Palette.muted, shape)
                .border(FIELD_EDGE.dp, if (focused) Palette.fg else Color.Transparent, shape),
        decorationBox = { inner ->
            Box(
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
                contentAlignment = Alignment.CenterStart,
            ) {
                if (value.isEmpty()) Text(text = placeholder, style = FIELD, color = Palette.mutedFg)
                inner()
            }
        },
    )
}

private const val COMPOSER_LINES = 5
private const val FIELD_HEIGHT = 40
private const val FIELD_RADIUS = 20
private const val FIELD_EDGE = 1.5f

private val FIELD =
    TextStyle(fontFamily = SansFamily, fontWeight = FontWeight.Medium, fontSize = 14.sp, lineHeight = 20.sp)
