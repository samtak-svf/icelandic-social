package samtak.spjall.social

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertWidthIsEqualTo
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.width
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import samtak.spjall.brand.R
import samtak.spjall.conversations.SCREENSHOT_SDK
import samtak.spjall.core.CommunityRole
import samtak.spjall.frames.FakeFrameRules
import samtak.spjall.frames.LocalFrameRules
import samtak.spjall.ui.SpjallTheme

/** The detail pane of Stjórna on an expanded window names its section and its fields take the pane's width (#205). */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [SCREENSHOT_SDK], qualifiers = "w1000dp-h900dp")
class ManageDetailTest {
    @get:Rule val compose = createComposeRule()

    private fun app() = RuntimeEnvironment.getApplication()

    private fun openManage() {
        val state = CommunityViewModel.State(community = community("k1", role = CommunityRole.OWNER), loaded = true)
        compose.setContent {
            CompositionLocalProvider(LocalFrameRules provides FakeFrameRules) {
                SpjallTheme { CommunityScreen(state, nothing<CommunityActions>()) }
            }
        }
        compose.onNodeWithText(app().getString(R.string.community_manage)).performClick()
    }

    @Test
    fun theEditPaneOpensWithAHeadingNamingTheSection() {
        openManage()
        val title = app().getString(R.string.community_edit)
        val heading = SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading) and hasText(title)
        compose.onNode(heading).assertIsDisplayed()
    }

    @Test
    fun theNameFieldTakesTheWidthOfThePane() {
        openManage()
        // The tagged node includes the pane's 16 dp padding on both sides; the field takes what is inside it.
        val pane = compose.onNodeWithTag(MANAGE_DETAIL).getUnclippedBoundsInRoot().width
        compose.onNodeWithTag(MANAGE_EDIT_NAME).assertWidthIsEqualTo(pane - 32.dp)
    }
}
