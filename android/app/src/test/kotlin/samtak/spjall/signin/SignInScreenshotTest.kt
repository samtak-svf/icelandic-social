package samtak.spjall.signin

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
import samtak.spjall.ui.SpjallTheme

/** The way in, in both modes: its hint has no colour of its own. See ConversationsScreenshotTest. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [SCREENSHOT_SDK], qualifiers = SCREENSHOT_DEVICE, fontScale = 1f)
class SignInScreenshotTest {
    @get:Rule val compose = createComposeRule()

    private fun shoot() {
        compose.setContent {
            SpjallTheme { SignInScreen(SignInViewModel.State(), onSignIn = {}, onRetry = {}) }
        }
        compose.onRoot().captureRoboImage()
    }

    @Test
    fun signedOut() = shoot()

    @Test
    @Config(qualifiers = "+night")
    fun signedOutAtNight() = shoot()
}
