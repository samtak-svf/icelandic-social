package samtak.spjall.onboarding

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import samtak.spjall.onboarding.OnboardingViewModel.Step

@OptIn(ExperimentalCoroutinesApi::class)
class OnboardingViewModelTest {
    private class MemoryStore(
        override var done: Boolean = false,
    ) : OnboardingStore

    private val store = MemoryStore()

    private fun model(needed: Boolean = true) = OnboardingViewModel(store) { needed }

    @Test
    fun aNewInstallStartsWithThePhotoThenNotifications() {
        val model = model()
        assertEquals(Step.Photo, model.step.value)
        model.photoDone()
        assertEquals(Step.Notifications, model.step.value)
        assertFalse("not done before the last step", store.done)
    }

    @Test
    fun theSystemPromptComesOnlyFromTheEnableButton() =
        runTest(UnconfinedTestDispatcher()) {
            val model = model()
            val asks = mutableListOf<Unit>()
            val collecting = launch { model.ask.collect { asks += it } }
            model.enable()
            assertTrue("no prompt on the photo step", asks.isEmpty())
            model.photoDone()
            assertTrue("no prompt on reaching the priming step", asks.isEmpty())
            model.enable()
            assertEquals(1, asks.size)
            assertEquals(Step.Notifications, model.step.value)
            model.asked()
            assertEquals(Step.Done, model.step.value)
            assertTrue(store.done)
            collecting.cancel()
        }

    @Test
    fun notNowFinishesWithoutThePrompt() =
        runTest(UnconfinedTestDispatcher()) {
            val model = model()
            val asks = mutableListOf<Unit>()
            val collecting = launch { model.ask.collect { asks += it } }
            model.photoDone()
            model.notNow()
            assertEquals(Step.Done, model.step.value)
            assertTrue(store.done)
            assertTrue(asks.isEmpty())
            collecting.cancel()
        }

    @Test
    fun withNothingToAskThePrimingStepIsSkipped() {
        // Android 12 and earlier, or the permission already granted.
        val model = model(needed = false)
        model.photoDone()
        assertEquals(Step.Done, model.step.value)
        assertTrue(store.done)
    }

    @Test
    fun anInstallThatWasThroughItSeesItNoMore() =
        runTest {
            store.done = true
            assertEquals(Step.Done, model().step.first())
        }
}
