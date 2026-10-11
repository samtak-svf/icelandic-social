package samtak.spjall.onboarding

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import samtak.spjall.brand.R
import samtak.spjall.core.Me
import samtak.spjall.me.MeViewModel
import samtak.spjall.onboarding.OnboardingViewModel.Step
import samtak.spjall.ui.SpjallTheme

@RunWith(AndroidJUnit4::class)
class OnboardingScreenTest {
    @get:Rule val compose = createComposeRule()

    private val calls = mutableListOf<String>()
    private val actions =
        object : OnboardingActions {
            override fun choosePhoto() {
                calls += "choosePhoto"
            }

            override fun photoDone() {
                calls += "photoDone"
            }

            override fun enable() {
                calls += "enable"
            }

            override fun notNow() {
                calls += "notNow"
            }

            override fun retry() {
                calls += "retry"
            }
        }

    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    private fun text(id: Int) = context.getString(id)

    private fun show(
        step: Step,
        me: MeViewModel.State = MeViewModel.State(),
    ) = compose.setContent { SpjallTheme { OnboardingScreen(step, me, actions) } }

    @Test
    fun thePhotoStepShowsTheNameAndOffersThePickerOrSkip() {
        show(Step.Photo, MeViewModel.State(me = ME))
        compose.onNodeWithText(text(R.string.onboarding_photo_title)).assertIsDisplayed()
        // The name sign-in delivered, as text: there is no field to edit it (0043).
        compose.onNodeWithText("JÓN JÓNSSON").assertIsDisplayed()
        compose.onNodeWithText(text(R.string.photo_choose)).performClick()
        compose.onNodeWithText(text(R.string.onboarding_skip)).performClick()
        assertEquals(listOf("choosePhoto", "photoDone"), calls)
    }

    @Test
    fun thePrimingStepEnablesOrPutsOff() {
        show(Step.Notifications)
        compose.onNodeWithText(text(R.string.notifications_priming_title)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.notifications_enable)).performClick()
        compose.onNodeWithText(text(R.string.not_now)).performClick()
        assertEquals(listOf("enable", "notNow"), calls)
    }

    private companion object {
        val ME = Me("a1", "Jón Jónsson", false, emptyList(), null)
    }
}
