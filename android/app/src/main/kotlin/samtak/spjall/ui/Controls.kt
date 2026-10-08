package samtak.spjall.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * A filled circle with one icon in it: the new-conversation button, the
 * composer's attach and send. The touch target stays 48dp however small
 * the circle is drawn.
 */
@Composable
fun RoundButton(
    icon: ImageVector,
    description: String,
    onClick: () -> Unit,
    fill: Color,
    tint: Color,
    size: Dp,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    iconSize: Dp = ICON.dp,
) {
    IconButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier,
        colors = IconButtonDefaults.iconButtonColors(contentColor = tint, disabledContentColor = tint),
    ) {
        Box(
            modifier = Modifier.size(size).background(fill, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = description, modifier = Modifier.size(iconSize))
        }
    }
}

/** Small capitals over a section of a screen, or a day in a conversation. */
@Composable
fun SectionLabel(
    text: String,
    modifier: Modifier = Modifier,
    color: Color = Palette.mutedFg,
    align: TextAlign? = null,
) {
    Text(
        text = text.uppercase(Dates.ICELANDIC),
        style = Type.sectionLabel,
        color = color,
        textAlign = align,
        modifier = modifier,
    )
}

/** Uppercase in Icelandic, whatever the device's language ("ð" stays "Ð"). */
fun String.capitals(): String = uppercase(Dates.ICELANDIC)

private const val ICON = 16
