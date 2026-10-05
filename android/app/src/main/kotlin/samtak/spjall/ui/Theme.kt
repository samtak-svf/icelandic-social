package samtak.spjall.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import samtak.spjall.brand.BrandTokens.Colors

/** Material roles filled from the generated brand tokens; the app names no colour itself. */
private val brandColors =
    lightColorScheme(
        primary = Color(Colors.PRIMARY),
        onPrimary = Color(Colors.PRIMARY_FG),
        secondary = Color(Colors.SECONDARY),
        onSecondary = Color(Colors.SECONDARY_FG),
        background = Color(Colors.SURFACE),
        onBackground = Color(Colors.FG),
        surface = Color(Colors.SURFACE),
        onSurface = Color(Colors.FG),
        surfaceVariant = Color(Colors.BG),
        onSurfaceVariant = Color(Colors.MUTED_FG),
        outline = Color(Colors.BORDER_STRONG),
        error = Color(Colors.DANGER),
        onError = Color(Colors.DANGER_FG),
    )

@Composable
fun SpjallTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = brandColors, content = content)
}
