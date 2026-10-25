package samtak.spjall.ui

import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import samtak.spjall.brand.R
import samtak.spjall.conversations.SCREENSHOT_SDK
import samtak.spjall.core.Frame
import samtak.spjall.frames.FakeFrameRules
import samtak.spjall.frames.LocalFrameRules

/**
 * The five places by window width (decision 0087): a bar along the bottom at the compact size class, a rail down the
 * left at medium and expanded, the count kept on the notifications tab, and neither on a screen opened from a tab.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [SCREENSHOT_SDK])
class AdaptiveNavigationTest {
    @get:Rule val compose = createComposeRule()

    private fun show(shown: Boolean = true) {
        val context = RuntimeEnvironment.getApplication()
        val tabs =
            listOf(
                Tab(AppIcons.Chat, context.getString(R.string.tab_conversations), selected = true) {},
                Tab(AppIcons.Communities, context.getString(R.string.tab_communities), selected = false) {},
                Tab(AppIcons.Bell, context.getString(R.string.tab_notifications), selected = false, badge = 3) {},
                Tab(AppIcons.Person, context.getString(R.string.tab_me), selected = false) {},
            )
        compose.setContent {
            CompositionLocalProvider(LocalFrameRules provides FakeFrameRules) {
                SpjallTheme { AdaptiveNavigation(tabs, shown) { Text("content") } }
            }
        }
    }

    private fun assertForm(
        present: String,
        absent: String,
    ) {
        compose.onNodeWithTag(present).assertIsDisplayed()
        compose.onNodeWithTag(absent).assertDoesNotExist()
        compose.onNodeWithText("3", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("content").assertIsDisplayed()
    }

    @Test
    @Config(qualifiers = "w412dp-h900dp")
    fun aBarAtCompact() {
        show()
        assertForm(NAVIGATION_BAR, NAVIGATION_RAIL)
    }

    @Test
    @Config(qualifiers = "w700dp-h900dp")
    fun aRailAtMedium() {
        show()
        assertForm(NAVIGATION_RAIL, NAVIGATION_BAR)
    }

    @Test
    @Config(qualifiers = "w1000dp-h900dp")
    fun aRailAtExpanded() {
        show()
        assertForm(NAVIGATION_RAIL, NAVIGATION_BAR)
    }

    @Test
    @Config(qualifiers = "w1000dp-h900dp")
    fun neitherOnAScreenOpenedFromATab() {
        show(shown = false)
        compose.onNodeWithTag(NAVIGATION_BAR).assertDoesNotExist()
        compose.onNodeWithTag(NAVIGATION_RAIL).assertDoesNotExist()
        compose.onNodeWithText("content").assertIsDisplayed()
    }

    @Test
    fun theLayoutOfEachSizeClass() {
        assertEquals(Navigation.BAR, layoutOf(Frame.COMPACT).navigation)
        assertEquals(Navigation.RAIL, layoutOf(Frame.MEDIUM).navigation)
        assertEquals(Navigation.RAIL, layoutOf(Frame.EXPANDED).navigation)
        val classes = listOf(Frame.COMPACT, Frame.MEDIUM, Frame.EXPANDED)
        assertEquals(listOf(false, false, true), classes.map { layoutOf(it).aside })
        assertEquals(
            listOf(false, false, true),
            classes.map { layoutOf(it).manageSideNav },
        )
    }
}
