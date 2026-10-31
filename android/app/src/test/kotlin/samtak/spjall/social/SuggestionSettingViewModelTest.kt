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

    @Test
    fun aRetryAfterAFailedWriteReadsTheServerAndDoesNotWriteAgain() =
        runTest(dispatcher) {
            val model = model()
            social.failOn = "setFriendSuggestionsIncluded false"
            model.set(false)
            advanceUntilIdle()
            assertNotNull(model.state.value.problem)
            val writes = social.calls.count { it.startsWith("setFriendSuggestionsIncluded") }
            assertEquals(1, writes)
            social.calls.clear()
            model.load()
            advanceUntilIdle()
            assertEquals(listOf("friendSuggestionsIncluded"), social.calls)
            assertNull(model.state.value.problem)
            assertEquals(true, model.state.value.included)
        }

    @Test
    fun aSecondLoadWithNoProblemReadsNothing() =
        runTest(dispatcher) {
            val model = model()
            assertEquals(true, model.state.value.included)
            assertNull(model.state.value.problem)
            social.calls.clear()
            model.load()
            advanceUntilIdle()
            assertTrue(social.calls.isEmpty())
        }
}
