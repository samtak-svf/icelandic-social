package samtak.spjall.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import samtak.spjall.brand.BrandTokens.Colors
import samtak.spjall.brand.BrandTokens.DarkColors
import samtak.spjall.brand.BrandTokens.FontFiles

/**
 * The brand's colours in one mode (decision 0052), by their token names. Both
 * modes are built from the generated tokens, which hold the same keys.
 */
@Immutable
class BrandPalette private constructor(
    private val dark: Boolean,
) {
    private fun pick(
        light: Long,
        night: Long,
    ) = Color(if (dark) night else light)

    val bg = pick(Colors.BG, DarkColors.BG)
    val surface = pick(Colors.SURFACE, DarkColors.SURFACE)
    val fg = pick(Colors.FG, DarkColors.FG)
    val primary = pick(Colors.PRIMARY, DarkColors.PRIMARY)
    val primaryFg = pick(Colors.PRIMARY_FG, DarkColors.PRIMARY_FG)
    val secondary = pick(Colors.SECONDARY, DarkColors.SECONDARY)
    val secondaryFg = pick(Colors.SECONDARY_FG, DarkColors.SECONDARY_FG)
    val proseBody = pick(Colors.PROSE_BODY, DarkColors.PROSE_BODY)
    val muted = pick(Colors.MUTED, DarkColors.MUTED)
    val mutedFg = pick(Colors.MUTED_FG, DarkColors.MUTED_FG)
    val primarySubtle = pick(Colors.PRIMARY_SUBTLE, DarkColors.PRIMARY_SUBTLE)
    val secondarySubtle = pick(Colors.SECONDARY_SUBTLE, DarkColors.SECONDARY_SUBTLE)
    val border = pick(Colors.BORDER, DarkColors.BORDER)
    val borderStrong = pick(Colors.BORDER_STRONG, DarkColors.BORDER_STRONG)
    val danger = pick(Colors.DANGER, DarkColors.DANGER)
    val dangerFg = pick(Colors.DANGER_FG, DarkColors.DANGER_FG)
    val bubbleOwnBg = pick(Colors.BUBBLE_OWN_BG, DarkColors.BUBBLE_OWN_BG)
    val bubbleOwnFg = pick(Colors.BUBBLE_OWN_FG, DarkColors.BUBBLE_OWN_FG)
    val bubbleOtherBg = pick(Colors.BUBBLE_OTHER_BG, DarkColors.BUBBLE_OTHER_BG)
    val bubbleOtherFg = pick(Colors.BUBBLE_OTHER_FG, DarkColors.BUBBLE_OTHER_FG)
    val verifiedMark = pick(Colors.VERIFIED_MARK, DarkColors.VERIFIED_MARK)

    companion object {
        val Light = BrandPalette(dark = false)
        val Dark = BrandPalette(dark = true)
    }
}

/** The palette of the mode on screen, which [SpjallTheme] provides. */
val LocalPalette = staticCompositionLocalOf { BrandPalette.Light }

/**
 * The brand's colours by their token names, for the places a Material role
 * does not describe (the cream band, the washes, the verification dot). Each
 * reads the mode on screen, so it is read in composition.
 */
object Palette {
    val bg: Color
        @Composable @ReadOnlyComposable
        get() = LocalPalette.current.bg

    val surface: Color
        @Composable @ReadOnlyComposable
        get() = LocalPalette.current.surface

    val fg: Color
        @Composable @ReadOnlyComposable
        get() = LocalPalette.current.fg

    val primary: Color
        @Composable @ReadOnlyComposable
        get() = LocalPalette.current.primary

    val primaryFg: Color
        @Composable @ReadOnlyComposable
        get() = LocalPalette.current.primaryFg

    val secondary: Color
        @Composable @ReadOnlyComposable
        get() = LocalPalette.current.secondary

    val secondaryFg: Color
        @Composable @ReadOnlyComposable
        get() = LocalPalette.current.secondaryFg

    val proseBody: Color
        @Composable @ReadOnlyComposable
        get() = LocalPalette.current.proseBody

    val muted: Color
        @Composable @ReadOnlyComposable
        get() = LocalPalette.current.muted

    val mutedFg: Color
        @Composable @ReadOnlyComposable
        get() = LocalPalette.current.mutedFg

    val primarySubtle: Color
        @Composable @ReadOnlyComposable
        get() = LocalPalette.current.primarySubtle

    val secondarySubtle: Color
        @Composable @ReadOnlyComposable
        get() = LocalPalette.current.secondarySubtle

    val border: Color
        @Composable @ReadOnlyComposable
        get() = LocalPalette.current.border

    val borderStrong: Color
        @Composable @ReadOnlyComposable
        get() = LocalPalette.current.borderStrong

    val danger: Color
        @Composable @ReadOnlyComposable
        get() = LocalPalette.current.danger

    val dangerFg: Color
        @Composable @ReadOnlyComposable
        get() = LocalPalette.current.dangerFg

    val bubbleOwnBg: Color
        @Composable @ReadOnlyComposable
        get() = LocalPalette.current.bubbleOwnBg

    val bubbleOwnFg: Color
        @Composable @ReadOnlyComposable
        get() = LocalPalette.current.bubbleOwnFg

    val bubbleOtherBg: Color
        @Composable @ReadOnlyComposable
        get() = LocalPalette.current.bubbleOtherBg

    val bubbleOtherFg: Color
        @Composable @ReadOnlyComposable
        get() = LocalPalette.current.bubbleOtherFg

    val verifiedMark: Color
        @Composable @ReadOnlyComposable
        get() = LocalPalette.current.verifiedMark
}

/**
 * Every Material role filled from the brand, so no baseline colour (the
 * Material purple) can reach the screen through a component default.
 */
private fun brandColors(
    palette: BrandPalette,
    dark: Boolean,
): ColorScheme =
    with(palette) {
        val primaryWash = primarySubtle.compositeOver(surface)
        val secondaryWash = secondarySubtle.compositeOver(surface)
        // Every role a mode differs in is set here, so one builder serves both;
        // the roles left out (the "fixed" ones) do not change with the mode.
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
            scrim = if (dark) Color.Black else fg,
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

private val lightScheme = brandColors(BrandPalette.Light, dark = false)
private val darkScheme = brandColors(BrandPalette.Dark, dark = true)

/** The brand theme in the system's mode, or in [dark] when a preview or test asks. */
@Composable
fun SpjallTheme(
    dark: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val palette = if (dark) BrandPalette.Dark else BrandPalette.Light
    CompositionLocalProvider(LocalPalette provides palette) {
        ProvideReduceMotion {
            MaterialTheme(
                colorScheme = if (dark) darkScheme else lightScheme,
                typography = brandType,
                content = content,
            )
        }
    }
}

/** The initials' size, from the circle in pixels and not the font scale (0053): the circle does not grow with text. */
internal fun Density.initialsSize(circle: Dp): TextUnit = (circle * INITIALS).toSp()

/** Initials take a third of their circle. */
private const val INITIALS = 0.33f
