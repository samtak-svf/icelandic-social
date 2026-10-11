package samtak.spjall.onboarding

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
import samtak.spjall.core.Me
import samtak.spjall.me.MeViewModel
import samtak.spjall.onboarding.OnboardingViewModel.Step
import samtak.spjall.ui.SpjallTheme

/** The first launch's two steps (decision 0043), compared with the images in src/test/screenshots/. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [SCREENSHOT_SDK], qualifiers = SCREENSHOT_DEVICE, fontScale = 1f)
class OnboardingScreenshotTest {
    @get:Rule val compose = createComposeRule()

    private val actions =
        object : OnboardingActions {
            override fun choosePhoto() = Unit

            override fun photoDone() = Unit

            override fun enable() = Unit

            override fun notNow() = Unit

            override fun retry() = Unit
        }

    private fun shoot(
        step: Step,
        me: MeViewModel.State = MeViewModel.State(),
    ) {
        compose.setContent { SpjallTheme { OnboardingScreen(step, me, actions) } }
        compose.onRoot().captureRoboImage()
    }

    @Test
    fun photo() = shoot(Step.Photo, MeViewModel.State(me = Me("a1", "Jón Jónsson", false, emptyList(), null)))

    @Test
    fun notifications() = shoot(Step.Notifications)
}
