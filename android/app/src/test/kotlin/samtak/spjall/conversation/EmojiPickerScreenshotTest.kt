package samtak.spjall.conversation

import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.dp
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import samtak.spjall.conversations.SCREENSHOT_DEVICE
import samtak.spjall.conversations.SCREENSHOT_SDK
import samtak.spjall.ui.SpjallTheme

/** The "more emoji" sheet's body with a navigation bar below it: Icelandic headers, the grid ends above the bar. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [SCREENSHOT_SDK], qualifiers = SCREENSHOT_DEVICE, fontScale = 1f)
class EmojiPickerScreenshotTest {
    @get:Rule val compose = createComposeRule()

    private var host: View? = null

    private fun loaded(view: View): Boolean =
        when (view) {
            is TextView -> view.text.contains("NOTAÐ NÝLEGA")
            is ViewGroup -> (0 until view.childCount).any { loaded(view.getChildAt(it)) }
            else -> false
        }

    @Test
    fun picker() {
        compose.setContent {
            host = LocalView.current
            SpjallTheme { EmojiPickerContent(onPick = {}, onDismiss = {}, insets = WindowInsets(bottom = 48.dp)) }
        }
        repeat(100) {
            compose.waitForIdle()
            if (loaded(host!!.rootView)) return@repeat
            Thread.sleep(50)
        }
        compose.onRoot().captureRoboImage()
    }
}
