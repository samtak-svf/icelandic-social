package samtak.spjall.me

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import samtak.spjall.conversations.SCREENSHOT_DEVICE
import samtak.spjall.conversations.SCREENSHOT_SDK
import samtak.spjall.core.LinkRequest
import samtak.spjall.me.link.LinkActions
import samtak.spjall.me.link.LinkApproveScreen
import samtak.spjall.me.link.LinkViewModel
import samtak.spjall.me.link.LinkViewModel.History
import samtak.spjall.ui.SpjallTheme

/** Approving a browser's link (decisions 0064, 0077). See ConversationsScreenshotTest. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [SCREENSHOT_SDK], qualifiers = SCREENSHOT_DEVICE, fontScale = 1f)
class LinkScreenshotTest {
    @get:Rule val compose = createComposeRule()

    private val actions =
        object : LinkActions {
            override fun back() = Unit

            override fun paste() = Unit

            override fun submit(text: String) = Unit

            override fun again() = Unit

            override fun retry() = Unit

            override fun choose(history: History) = Unit

            override fun approve() = Unit
        }

    private fun shoot(state: LinkViewModel.State) {
        compose.setContent { SpjallTheme { LinkApproveScreen(state, actions) } }
        compose.onRoot().captureRoboImage()
    }

    @Test
    fun approve() = shoot(LinkViewModel.State.Approve(LinkRequest("Firefox", "Linux", 1L, false)))

    @Test
    fun approveWithNothingSent() = shoot(LinkViewModel.State.Approve(LinkRequest(null, null, 1L, false), History.NONE))

    @Test
    @Config(qualifiers = "+night")
    fun approveAtNight() = shoot(LinkViewModel.State.Approve(LinkRequest("Firefox", "Linux", 1L, false)))

    @Test
    fun sending() = shoot(LinkViewModel.State.Sending(History.RECENT))
}
