package samtak.spjall.social

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import samtak.spjall.brand.R
import samtak.spjall.conversations.SCREENSHOT_DEVICE
import samtak.spjall.conversations.SCREENSHOT_SDK
import samtak.spjall.ui.BELL
import samtak.spjall.ui.Bell
import samtak.spjall.ui.LocalBell
import samtak.spjall.ui.SpjallTheme

/** The header of a screen opened from a tab (a post, a community, the queues) ends with the bell (decision 0111). */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [SCREENSHOT_SDK], qualifiers = SCREENSHOT_DEVICE, fontScale = 1f)
class SubHeaderBellTest {
    @get:Rule val compose = createComposeRule()

    private fun show(withBell: Boolean) {
        val label = RuntimeEnvironment.getApplication().getString(R.string.notifications_title)
        val bell = if (withBell) Bell(label, 2, null, false) {} else null
        compose.setContent {
            SpjallTheme { CompositionLocalProvider(LocalBell provides bell) { SubHeader("x", onBack = {}) } }
        }
    }

    @Test
    fun theHeaderEndsWithTheBell() {
        show(withBell = true)
        compose.onNodeWithTag(BELL).assertIsDisplayed()
    }

    @Test
    fun withoutTheShellsBellTheHeaderDrawsNone() {
        show(withBell = false)
        compose.onNodeWithTag(BELL).assertDoesNotExist()
    }
}
