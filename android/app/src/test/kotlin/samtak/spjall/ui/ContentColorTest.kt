package samtak.spjall.ui

import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.Surface
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * What a Text or Icon with no colour of its own gets. Material finds it only for a
 * background that is one of its roles, and the band is not one, so without the
 * theme's default such a text is unreadable in the dark mode.
 */
@RunWith(RobolectricTestRunner::class)
class ContentColorTest {
    @get:Rule val compose = createComposeRule()

    private fun assertDefault(
        dark: Boolean,
        on: Boolean,
    ) {
        var seen = Color.Unspecified
        var fg = Color.Magenta
        compose.setContent {
            SpjallTheme(dark = dark) {
                fg = Palette.fg
                if (on) {
                    Surface(color = Palette.bg) { seen = LocalContentColor.current }
                } else {
                    seen = LocalContentColor.current
                }
            }
        }
        compose.waitForIdle()
        assertEquals(fg, seen)
    }

    @Test
    fun theBandDefaultsToTheTextColourInTheDark() = assertDefault(dark = true, on = true)

    @Test
    fun theBandDefaultsToTheTextColourInTheLight() = assertDefault(dark = false, on = true)

    @Test
    fun outsideAnySurfaceTheDefaultIsTheTextColourInTheDark() = assertDefault(dark = true, on = false)
}
