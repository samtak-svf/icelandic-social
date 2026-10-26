package samtak.spjall.conversation

import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import samtak.spjall.conversations.SCREENSHOT_SDK
import samtak.spjall.ui.SpjallTheme

// The screenshot device, on an English phone.
private const val SCREENSHOT_DEVICE_REST = "-w393dp-h851dp-normal-long-notround-any-440dpi-keyshidden-nonav"

/** The emoji picker speaks Icelandic whatever the device language, and clears the navigation bar (#295). */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [SCREENSHOT_SDK], qualifiers = "en" + SCREENSHOT_DEVICE_REST, fontScale = 1f)
class EmojiPickerTest {
    @get:Rule val compose = createComposeRule()

    private var bottomPx = 0f
    private var host: View? = null

    private fun show() {
        compose.setContent {
            host = LocalView.current
            bottomPx = with(LocalDensity.current) { NAV_BAR.toPx() }
            SpjallTheme {
                EmojiPickerContent(onPick = {}, onDismiss = {}, insets = WindowInsets(bottom = NAV_BAR))
            }
        }
    }

    private fun texts(view: View): List<String> =
        when (view) {
            is TextView -> listOf(view.text.toString())
            is ViewGroup -> (0 until view.childCount).flatMap { texts(view.getChildAt(it)) }
            else -> emptyList()
        }

    @Test
    fun theCategoryHeadersAreIcelandicOnAnEnglishDevice() {
        show()
        var found: List<String> = emptyList()
        repeat(100) {
            compose.waitForIdle()
            Thread.sleep(50)
            found = texts(host!!.rootView)
            if (found.any { it.contains("NOTAÐ NÝLEGA") }) return
        }
        assertTrue("an Icelandic header among $found", found.any { it.contains("NOTAÐ NÝLEGA") })
        assertTrue("no English header among $found", found.none { it.contains("RECENTLY USED") })
    }

    @Test
    fun theGridEndsAboveTheNavigationBar() {
        show()
        val root =
            compose
                .onRoot()
                .fetchSemanticsNode()
                .boundsInRoot.height
        val grid =
            compose
                .onNodeWithTag("emoji-picker")
                .fetchSemanticsNode()
                .boundsInRoot
        assertTrue("grid bottom ${grid.bottom} above ${root - bottomPx}", grid.bottom <= root - bottomPx)
    }

    private companion object {
        val NAV_BAR = 60.dp
    }
}
