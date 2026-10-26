package samtak.spjall.ui

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.text.TextLayoutResult
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Assert.assertEquals
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

/**
 * The bottom bar with its four tabs, the third with a count. At twice the text size each name stays on one
 * line, smaller, instead of breaking inside the word (seen on a phone with 0.9.0).
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [SCREENSHOT_SDK], qualifiers = SCREENSHOT_DEVICE, fontScale = 1f)
class TabBarScreenshotTest {
    @get:Rule val compose = createComposeRule()

    private fun four(): List<Tab> {
        val context = RuntimeEnvironment.getApplication()
        return listOf(
            Tab(AppIcons.Chat, context.getString(R.string.tab_conversations), selected = false) {},
            Tab(AppIcons.Communities, context.getString(R.string.tab_communities), selected = true) {},
            Tab(AppIcons.Bell, context.getString(R.string.tab_notifications), selected = false, badge = 3) {},
            Tab(AppIcons.Person, context.getString(R.string.tab_me), selected = false) {},
        )
    }

    @Test
    fun tabs() {
        compose.setContent { SpjallTheme { TabBar(four()) } }
        compose.onRoot().captureRoboImage()
    }

    @Test
    @Config(qualifiers = "+night")
    fun night() {
        compose.setContent { SpjallTheme { TabBar(four()) } }
        compose.onRoot().captureRoboImage()
    }

    @Test
    @Config(fontScale = 2f)
    fun largeText() {
        compose.setContent { SpjallTheme { TabBar(four()) } }
        compose.onRoot().captureRoboImage()
    }

    @Test
    @Config(fontScale = 2f)
    fun noNameIsCutAtTwiceTheTextSize() {
        compose.setContent { SpjallTheme { TabBar(four()) } }
        assertEquals(emptyList<String>(), compose.wordsCut())
    }

    // The size a name is drawn at is read off its line's height, which follows the font size.
    private fun nameSizes(): List<Float> =
        compose
            .onAllNodes(hasText("", substring = true), useUnmergedTree = true)
            .fetchSemanticsNodes()
            .mapNotNull { node ->
                val layouts = mutableListOf<TextLayoutResult>()
                node.config
                    .getOrNull(SemanticsActions.GetTextLayoutResult)
                    ?.action
                    ?.invoke(layouts)
                val line = layouts.firstOrNull()?.takeIf { it.layoutInput.maxLines == 1 }
                line?.let { it.getLineBottom(0) - it.getLineTop(0) }
            }

    @Test
    @Config(fontScale = 2f)
    fun everyNameIsTheSameSizeAtTwiceTheTextSize() {
        compose.setContent { SpjallTheme { TabBar(four()) } }
        val sizes = nameSizes()
        assertEquals(4, sizes.size)
        assertEquals(1, sizes.toSet().size)
    }

    @Test
    @Config(fontScale = 1.5f)
    fun everyNameIsTheSameSizeAtOneAndAHalfTheTextSize() {
        compose.setContent { SpjallTheme { TabBar(four()) } }
        val sizes = nameSizes()
        assertEquals(4, sizes.size)
        assertEquals(1, sizes.toSet().size)
    }
}
