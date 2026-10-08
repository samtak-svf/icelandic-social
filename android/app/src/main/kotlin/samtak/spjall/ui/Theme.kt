package samtak.spjall.ui

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import samtak.spjall.brand.BrandTokens.Colors
import samtak.spjall.brand.BrandTokens.FontFiles

/**
 * The brand's colours by their token names, for the places a Material role
 * does not describe (the cream band, the washes, the verification dot).
 */
object Palette {
    val bg = Color(Colors.BG)
    val surface = Color(Colors.SURFACE)
    val fg = Color(Colors.FG)
    val primary = Color(Colors.PRIMARY)
    val primaryFg = Color(Colors.PRIMARY_FG)
    val secondary = Color(Colors.SECONDARY)
    val secondaryFg = Color(Colors.SECONDARY_FG)
    val proseBody = Color(Colors.PROSE_BODY)
    val muted = Color(Colors.MUTED)
    val mutedFg = Color(Colors.MUTED_FG)
    val primarySubtle = Color(Colors.PRIMARY_SUBTLE)
    val secondarySubtle = Color(Colors.SECONDARY_SUBTLE)
    val border = Color(Colors.BORDER)
    val borderStrong = Color(Colors.BORDER_STRONG)
    val danger = Color(Colors.DANGER)
    val dangerFg = Color(Colors.DANGER_FG)
    val bubbleOwnBg = Color(Colors.BUBBLE_OWN_BG)
    val bubbleOwnFg = Color(Colors.BUBBLE_OWN_FG)
    val bubbleOtherBg = Color(Colors.BUBBLE_OTHER_BG)
    val bubbleOtherFg = Color(Colors.BUBBLE_OTHER_FG)
    val verifiedMark = Color(Colors.VERIFIED_MARK)
}

/**
 * Every Material role filled from the brand, so no baseline colour (the
 * Material purple) can reach the screen through a component default. The
 * app uses one light scheme; it has no dark tokens yet.
 */
private val brandColors: ColorScheme =
    with(Palette) {
        val primaryWash = primarySubtle.compositeOver(surface)
        val secondaryWash = secondarySubtle.compositeOver(surface)
        lightColorScheme(
            primary = primary,
            onPrimary = primaryFg,
            primaryContainer = primaryWash,
            onPrimaryContainer = fg,
            inversePrimary = primarySubtle.compositeOver(fg),
            secondary = secondary,
            onSecondary = secondaryFg,
            secondaryContainer = secondaryWash,
            onSecondaryContainer = fg,
            tertiary = secondary,
            onTertiary = secondaryFg,
            tertiaryContainer = secondaryWash,
            onTertiaryContainer = fg,
            background = surface,
            onBackground = fg,
            surface = surface,
            onSurface = fg,
            surfaceVariant = muted,
            onSurfaceVariant = mutedFg,
            surfaceTint = surface,
            inverseSurface = fg,
            inverseOnSurface = surface,
            error = danger,
            onError = dangerFg,
            errorContainer = primaryWash,
            onErrorContainer = fg,
            outline = borderStrong.compositeOver(surface),
            outlineVariant = border.compositeOver(surface),
            scrim = fg,
            surfaceBright = surface,
            surfaceDim = muted,
            surfaceContainerLowest = surface,
            surfaceContainerLow = surface,
            surfaceContainer = surface,
            surfaceContainerHigh = surface,
            surfaceContainerHighest = muted,
        )
    }

private fun family(files: List<Pair<Int, Int>>): FontFamily =
    if (files.isEmpty()) {
        FontFamily.Default
    } else {
        FontFamily(
            files.map { (res, weight) ->
                Font(res, FontWeight(weight))
            },
        )
    }

/** Body text: the brand's sans, medium and black. */
val SansFamily = family(FontFiles.SANS)

/** Headlines: the brand's condensed face, always set in capitals. */
val HeadlineFamily = family(FontFiles.HEADLINE)

private fun TextStyle.sans(weight: FontWeight) = copy(fontFamily = SansFamily, fontWeight = weight)

private val brandType =
    Typography().run {
        Typography(
            displayLarge = displayLarge.copy(fontFamily = HeadlineFamily, fontWeight = FontWeight.ExtraBold),
            displayMedium = displayMedium.copy(fontFamily = HeadlineFamily, fontWeight = FontWeight.ExtraBold),
            displaySmall = displaySmall.copy(fontFamily = HeadlineFamily, fontWeight = FontWeight.ExtraBold),
            headlineLarge = headlineLarge.copy(fontFamily = HeadlineFamily, fontWeight = FontWeight.ExtraBold),
            headlineMedium = headlineMedium.copy(fontFamily = HeadlineFamily, fontWeight = FontWeight.ExtraBold),
            headlineSmall = headlineSmall.copy(fontFamily = HeadlineFamily, fontWeight = FontWeight.ExtraBold),
            titleLarge = titleLarge.sans(FontWeight.Black),
            titleMedium = titleMedium.sans(FontWeight.Black),
            titleSmall = titleSmall.sans(FontWeight.Black),
            bodyLarge = bodyLarge.sans(FontWeight.Medium),
            bodyMedium = bodyMedium.sans(FontWeight.Medium),
            bodySmall = bodySmall.sans(FontWeight.Medium),
            labelLarge = labelLarge.sans(FontWeight.Black),
            labelMedium = labelMedium.sans(FontWeight.Black),
            labelSmall = labelSmall.sans(FontWeight.Black),
        )
    }

/** The design's own sizes, where a Material role is not close enough. */
object Type {
    /** A screen title in the cream band: condensed capitals. */
    val screenTitle =
        TextStyle(fontFamily = HeadlineFamily, fontWeight = FontWeight.ExtraBold, fontSize = 30.sp, lineHeight = 32.sp)

    /** The account name on Ég. */
    val accountName = screenTitle.copy(fontSize = 24.sp, lineHeight = 26.sp)

    /** Small capitals over a section, a day in a conversation. */
    val sectionLabel =
        TextStyle(fontFamily = SansFamily, fontWeight = FontWeight.Black, fontSize = 10.sp, letterSpacing = 0.14.em)

    /** A message's text. */
    val bubble =
        TextStyle(fontFamily = SansFamily, fontWeight = FontWeight.Medium, fontSize = 14.5.sp, lineHeight = 21.sp)

    /** Time and read state under a message, a row's time. */
    val meta = TextStyle(fontFamily = SansFamily, fontWeight = FontWeight.Black, fontSize = 10.sp, lineHeight = 13.sp)
}

@Composable
fun SpjallTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = brandColors, typography = brandType, content = content)
}
