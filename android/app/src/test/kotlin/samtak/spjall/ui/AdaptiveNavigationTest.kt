package samtak.spjall.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertWidthIsAtLeast
import androidx.compose.ui.test.assertWidthIsEqualTo
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
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
 * The places by window width (decision 0087): a bar along the bottom at the compact size class, a rail down the left
 * at medium and expanded, and neither on a screen opened from a tab. The notifications are no tab: they are the bell
 * at the end of every tab's header, with its count, at every width (decision 0109).
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [SCREENSHOT_SDK])
class AdaptiveNavigationTest {
    @get:Rule val compose = createComposeRule()

    private var rang = 0

    private fun show(
        shown: Boolean = true,
        wide: Boolean = false,
    ) {
        val context = RuntimeEnvironment.getApplication()
        val tabs =
            listOf(
                Tab(AppIcons.Chat, context.getString(R.string.tab_conversations), selected = true) {},
                Tab(AppIcons.Communities, context.getString(R.string.tab_communities), selected = false) {},
                Tab(AppIcons.Person, context.getString(R.string.tab_me), selected = false) {},
            )
        val bell = Bell(context.getString(R.string.notifications_title), 3, UNREAD, selected = false) { rang++ }
        compose.setContent {
            CompositionLocalProvider(LocalFrameRules provides FakeFrameRules) {
                SpjallTheme {
                    AdaptiveNavigation(tabs, bell, shown, wide) {
                        Column {
                            ScreenHeader(context.getString(R.string.tab_conversations))
                            Text("content", Modifier.fillMaxWidth().testTag(CONTENT))
                        }
                    }
                }
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
    @Config(qualifiers = "w412dp-h900dp")
    fun theBellIsInTheHeaderWithItsCountAtCompact() = assertBell()

    @Test
    @Config(qualifiers = "w1000dp-h900dp")
    fun theBellIsInTheHeaderWithItsCountAtExpanded() = assertBell()

    // The bell is named, its count read out with it, and a tap opens the notifications.
    private fun assertBell() {
        show()
        val context = RuntimeEnvironment.getApplication()
        compose
            .onNodeWithTag(BELL)
            .assertIsDisplayed()
            .assert(hasContentDescription(context.getString(R.string.notifications_title)))
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, UNREAD))
            .performClick()
        assertEquals(1, rang)
        // The count is drawn once, on the bell: no tab carries one.
        compose.onAllNodesWithText("3", useUnmergedTree = true).assertCountEquals(1)
    }

    @Test
    @Config(qualifiers = "w1000dp-h900dp")
    fun neitherOnAScreenOpenedFromATab() {
        show(shown = false)
        compose.onNodeWithTag(NAVIGATION_BAR).assertDoesNotExist()
        compose.onNodeWithTag(NAVIGATION_RAIL).assertDoesNotExist()
        compose.onNodeWithText("content").assertIsDisplayed()
    }

    // The content is one column no wider than the web's (0087), on a window wider than that beside the rail.
    @Test
    @Config(qualifiers = "w800dp-h900dp")
    fun oneColumnAtMedium() {
        show(wide = true)
        compose.onNodeWithTag(CONTENT).assertWidthIsEqualTo(CONTENT_WIDTH.dp)
    }

    @Test
    @Config(qualifiers = "w1000dp-h900dp")
    fun oneColumnAtExpandedOnAScreenThatIsNotWide() {
        show()
        compose.onNodeWithTag(CONTENT).assertWidthIsEqualTo(CONTENT_WIDTH.dp)
    }

    @Test
    @Config(qualifiers = "w1000dp-h900dp")
    fun aWideScreenTakesTheWholeWidthAtExpanded() {
        show(wide = true)
        compose.onNodeWithTag(CONTENT).assertWidthIsAtLeast((CONTENT_WIDTH + 1).dp)
    }

    // The table of web/src/ui/layout.ts, field by field, class by class.
    private fun layout(
        window: Frame,
        expected: Layout,
    ) = assertEquals(expected, layoutOf(window))

    @Test
    fun compactLayoutEqualsTheWebsCompactRow() {
        val compact = layoutOf(Frame.COMPACT)
        assertEquals(Navigation.BAR, compact.navigation)
        assertEquals(CommunityLayout.COLUMN, compact.community)
        assertEquals(5, compact.memberPictures)
        assertEquals(ManageLayout.ONE_SCREEN, compact.manage)
        assertEquals(FeaturedLayout.STRIP, compact.featured)
        assertEquals(HubLayout.TABS, compact.hub)
        assertEquals(CreateLayout.FORM, compact.create)
        assertEquals(TabsLayout.SCROLL, compact.tabs)
    }

    @Test
    fun mediumLayoutEqualsTheWebsMediumRow() {
        val medium = layoutOf(Frame.MEDIUM)
        assertEquals(Navigation.RAIL, medium.navigation)
        assertEquals(CommunityLayout.COLUMN, medium.community)
        assertEquals(12, medium.memberPictures)
        assertEquals(ManageLayout.ONE_SCREEN, medium.manage)
        assertEquals(FeaturedLayout.STRIP, medium.featured)
        assertEquals(HubLayout.TABS, medium.hub)
        assertEquals(CreateLayout.FORM, medium.create)
        assertEquals(TabsLayout.ROW, medium.tabs)
    }

    @Test
    fun expandedLayoutEqualsTheWebsExpandedRow() {
        val expanded = layoutOf(Frame.EXPANDED)
        assertEquals(Navigation.RAIL, expanded.navigation)
        assertEquals(CommunityLayout.FEED_AND_ASIDE, expanded.community)
        assertEquals(12, expanded.memberPictures)
        assertEquals(ManageLayout.SIDE_NAV, expanded.manage)
        assertEquals(FeaturedLayout.ASIDE, expanded.featured)
        assertEquals(HubLayout.COLUMN, expanded.hub)
        assertEquals(CreateLayout.FORM_AND_PREVIEW, expanded.create)
        assertEquals(TabsLayout.ROW, expanded.tabs)
    }

    @Test
    fun aSquareWindowIsLaidOutAsCompact() = layout(Frame.SQUARE, layoutOf(Frame.COMPACT))

    private companion object {
        const val CONTENT = "content"
        const val UNREAD = "3 unread"
    }
}
