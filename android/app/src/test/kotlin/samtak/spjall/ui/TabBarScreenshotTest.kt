package samtak.spjall.ui

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
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
}
