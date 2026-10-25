package samtak.spjall.social

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
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
import java.lang.reflect.Proxy

/**
 * A community by window width (decision 0087): Um samfélagið beside the feed only at the expanded size class, and
 * Stjórna as a section list beside the section chosen only there too.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [SCREENSHOT_SDK])
class AdaptiveCommunityTest {
    @get:Rule val compose = createComposeRule()

    private val choir =
        community("k1", role = CommunityRole.OWNER).copy(description = "Æfingar á þriðjudögum")

    private fun show() {
        val state = CommunityViewModel.State(community = choir, loaded = true)
        compose.setContent {
            CompositionLocalProvider(LocalFrameRules provides FakeFrameRules) {
                SpjallTheme { CommunityScreen(state, nothing<CommunityActions>()) }
            }
        }
    }

    private fun openManage() {
        compose.onNodeWithText(RuntimeEnvironment.getApplication().getString(R.string.community_manage)).performClick()
    }

    @Test
    @Config(qualifiers = "w412dp-h900dp")
    fun noAsideAtCompact() {
        show()
        compose.onNodeWithTag(COMMUNITY_ASIDE).assertDoesNotExist()
        openManage()
        compose.onNodeWithTag(MANAGE_SECTIONS).assertDoesNotExist()
    }

    @Test
    @Config(qualifiers = "w700dp-h900dp")
    fun noAsideAtMedium() {
        show()
        compose.onNodeWithTag(COMMUNITY_ASIDE).assertDoesNotExist()
        openManage()
        compose.onNodeWithTag(MANAGE_SECTIONS).assertDoesNotExist()
    }

    @Test
    @Config(qualifiers = "w1000dp-h900dp")
    fun anAsideAndTwoPanesAtExpanded() {
        show()
        compose.onNodeWithTag(COMMUNITY_ASIDE).assertIsDisplayed()
        openManage()
        compose.onNodeWithTag(MANAGE_SECTIONS).assertIsDisplayed()
        compose.onNodeWithTag(MANAGE_DETAIL).assertIsDisplayed()
    }
}

/** Actions that do nothing: a test only looks at the layout. */
private inline fun <reified T> nothing(): T =
    Proxy.newProxyInstance(T::class.java.classLoader, arrayOf(T::class.java)) { proxy, method, args ->
        when (method.name) {
            "equals" -> proxy === args[0]
            "hashCode" -> System.identityHashCode(proxy)
            "toString" -> "nothing"
            else -> null
        }
    } as T
