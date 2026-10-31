package samtak.spjall.social

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SuggestionSettingViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val social = FakeSocial()

    @Before fun main() = Dispatchers.setMain(dispatcher)

    @After fun reset() = Dispatchers.resetMain()

    private fun TestScope.model() =
        SuggestionSettingViewModel(social, dispatcher).also {
            it.load()
            advanceUntilIdle()
        }

    @Test
    fun theSwitchStartsAsTheServerHasIt() =
        runTest(dispatcher) {
            social.suggestionsIncluded = false
            assertEquals(false, model().state.value.included)
        }

    @Test
    fun aWriteGoesToTheCoreAndIsReadBack() =
        runTest(dispatcher) {
            val model = model()
            assertEquals(true, model.state.value.included)
            social.calls.clear()
            model.set(false)
            advanceUntilIdle()
            assertEquals(listOf("setFriendSuggestionsIncluded false", "friendSuggestionsIncluded"), social.calls)
            assertEquals(false, model.state.value.included)
            assertFalse(model.state.value.busy)
        }

    @Test
    fun theSwitchIsHeldWhileAWriteRuns() =
        runTest(dispatcher) {
            val model = model()
            model.set(false)
            assertTrue(model.state.value.busy)
            model.set(true)
            advanceUntilIdle()
            assertEquals(1, social.calls.count { it.startsWith("setFriendSuggestionsIncluded") })
            assertEquals(false, model.state.value.included)
        }

    @Test
    fun aFailedWriteShowsItsProblemAndKeepsWhatTheServerHas() =
        runTest(dispatcher) {
            val model = model()
            assertEquals(true, model.state.value.included)
            social.failOn = "setFriendSuggestionsIncluded false"
            model.set(false)
            advanceUntilIdle()
            assertTrue("setFriendSuggestionsIncluded false" in social.calls)
            assertNotNull(model.state.value.problem)
            assertEquals(true, model.state.value.included)
            assertTrue(social.suggestionsIncluded)
            assertFalse(model.state.value.busy)
        }

    @Test
    fun aFailedReadShowsNoSwitch() =
        runTest(dispatcher) {
            social.failOn = "friendSuggestionsIncluded"
            val model = model()
            assertTrue("friendSuggestionsIncluded" in social.calls)
            assertNull(model.state.value.included)
            assertNotNull(model.state.value.problem)
        }
}
