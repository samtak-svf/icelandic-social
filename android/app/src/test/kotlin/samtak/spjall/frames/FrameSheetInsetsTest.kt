package samtak.spjall.frames

import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.platform.LocalDensity
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
import samtak.spjall.conversations.SCREENSHOT_DEVICE
import samtak.spjall.conversations.SCREENSHOT_SDK
import samtak.spjall.core.FrameKind
import samtak.spjall.ui.SpjallTheme

/** The crop sheet keeps its controls inside the system bars (#172): the dialog draws edge to edge. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [SCREENSHOT_SDK], qualifiers = SCREENSHOT_DEVICE, fontScale = 1f)
class FrameSheetInsetsTest {
    @get:Rule val compose = createComposeRule()

    private var topPx = 0f
    private var bottomPx = 0f

    private fun show(state: FrameState) {
        compose.setContent {
            val density = LocalDensity.current
            topPx = with(density) { STATUS_BAR.toPx() }
            bottomPx = with(density) { NAV_BAR.toPx() }
            SpjallTheme {
                FrameSheetRoot(
                    state = state,
                    onSave = {},
                    onClose = {},
                    insets = WindowInsets(top = STATUS_BAR, bottom = NAV_BAR),
                    rules = FakeFrameRules,
                )
            }
        }
    }

    private fun bounds(tag: String) =
        compose
            .onNodeWithTag(tag)
            .fetchSemanticsNode()
            .boundsInRoot

    private fun rootHeight() =
        compose
            .onRoot()
            .fetchSemanticsNode()
            .boundsInRoot.height

    @Test
    fun theTitleAndTheSaveRowSitBetweenTheBars() {
        show(FrameState.Editing(request = request(), image = bandedImage(), base = null))
        assertTrue("title below the status bar", bounds("frame-title").top >= topPx)
        assertTrue("Save above the navigation bar", bounds("frame-save").bottom <= rootHeight() - bottomPx)
        assertTrue("Cancel above the navigation bar", bounds("frame-cancel").bottom <= rootHeight() - bottomPx)
    }

    @Test
    fun theUnavailableMessageSitsBelowTheStatusBar() {
        show(FrameState.Unavailable())
        assertTrue("message below the status bar", bounds("frame-unavailable").top >= topPx)
    }

    private fun request() =
        FrameRequest(
            kind = FrameKind.PHOTO,
            base = { null },
            master = { null },
            save = {},
        )

    private companion object {
        val STATUS_BAR = 40.dp
        val NAV_BAR = 60.dp
    }
}
