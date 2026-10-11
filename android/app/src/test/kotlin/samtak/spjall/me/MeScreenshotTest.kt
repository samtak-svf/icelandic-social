package samtak.spjall.me

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Modifier
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
import samtak.spjall.core.Me
import samtak.spjall.ui.Palette
import samtak.spjall.ui.SpjallTheme

/**
 * Ég with its larger photo that opens the picker and its settings below (decisions 0043,
 * 0044), and the blocked list's empty state. See ConversationsScreenshotTest.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [SCREENSHOT_SDK], qualifiers = SCREENSHOT_DEVICE, fontScale = 1f)
class MeScreenshotTest {
    @get:Rule val compose = createComposeRule()

    private val me = Me("a1", "Jón Jónsson", true, emptyList(), null)

    @Test
    fun me() {
        compose.setContent { SpjallTheme { MeScreen(MeViewModel.State(me = me), NoMeActions()) } }
        compose.onRoot().captureRoboImage()
    }

    @Test
    fun nobodyBlocked() {
        // The section alone, so the image shows the empty state without the screen around it.
        compose.setContent {
            SpjallTheme {
                Column(modifier = Modifier.background(Palette.bg).padding(16.dp)) {
                    Panel { BlockedSection(emptyList(), enabled = true, onUnblock = {}) }
                }
            }
        }
        compose.onRoot().captureRoboImage()
    }
}

private class NoMeActions : MeActions {
    override fun newLink() = Unit

    override fun share(link: String) = Unit

    override fun readMarkers(on: Boolean) = Unit

    override fun typing(on: Boolean) = Unit

    override fun unblock(account: String) = Unit

    override fun revoke(deviceId: String) = Unit

    override fun deleteAccount() = Unit

    override fun choosePhoto() = Unit

    override fun removePhoto() = Unit

    override fun retry() = Unit

    override fun verify() = Unit

    override fun notificationSettings() = Unit
}
