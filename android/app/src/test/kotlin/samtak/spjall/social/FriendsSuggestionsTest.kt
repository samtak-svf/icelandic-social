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
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import samtak.spjall.core.Author
import samtak.spjall.core.Relation

/** The people this account may know, on the friends screen (decision 0114). */
@OptIn(ExperimentalCoroutinesApi::class)
class FriendsSuggestionsTest {
    private val dispatcher = StandardTestDispatcher()
    private val social = FakeSocial()
    private val suggested = listOf("s1", "s2", "s3").map { Author(it, "Fólk $it", false) }

    @Before fun main() = Dispatchers.setMain(dispatcher)

    @After fun reset() = Dispatchers.resetMain()

    @Before fun people() {
        social.people["a2"] = profile(anna, Relation.FRIENDS, friendsSince = 10uL)
        suggested.forEach {
            social.people[it.accountId] = profile(it, Relation.NONE)
            social.suggested += it
        }
    }

    private fun TestScope.model() = FriendsViewModel(social, dispatcher).also { advanceUntilIdle() }

    /** The reads of a page; the read of the setting is not one. */
    private fun pageReads() = social.calls.filter { it == "friendSuggestions" || it.startsWith("friendSuggestions ") }

    private fun FriendsViewModel.shown() = state.value.suggestions.map { it.accountId }

    @Test
    fun theSectionShowsTheFirstPageAndKeepsTheCursor() =
        runTest(dispatcher) {
            val model = model()
            assertTrue("friendSuggestionsIncluded" in social.calls)
            assertEquals(listOf("s1", "s2"), model.shown())
            assertEquals("2", model.state.value.suggestionsNext)
        }

    @Test
    fun nothingShowsWhileTheAccountIsOutAndTheSuggestionsAreNotAsked() =
        runTest(dispatcher) {
            social.suggestionsIncluded = false
            val model = model()
            assertTrue(model.state.value.loaded)
            assertTrue("friendSuggestionsIncluded" in social.calls)
            assertTrue(model.shown().isEmpty())
            assertTrue(pageReads().isEmpty())
        }

    @Test
    fun aFailedReadShowsNothingAndLeavesTheListsAlone() =
        runTest(dispatcher) {
            social.failOn = "friendSuggestionsIncluded"
            val model = model()
            val state = model.state.value
            assertTrue("friendSuggestionsIncluded" in social.calls)
            assertTrue(state.loaded)
            assertEquals(listOf("a2"), state.friends.map { it.person.accountId })
            assertNull(state.problem)
            assertTrue(model.shown().isEmpty())
        }

    @Test
    fun aFailedPageKeepsWhatIsShownAndAsksNoError() =
        runTest(dispatcher) {
            val model = model()
            social.failOn = "friendSuggestions 2"
            model.moreSuggestions()
            advanceUntilIdle()
            assertTrue("friendSuggestions 2" in social.calls)
            assertEquals(listOf("s1", "s2"), model.shown())
            assertNull(model.state.value.problem)
        }

    @Test
    fun morePassesTheCursorBackAndTheLastPageEndsIt() =
        runTest(dispatcher) {
            val model = model()
            assertNotNull(model.state.value.suggestionsNext)
            model.moreSuggestions()
            advanceUntilIdle()
            assertTrue("friendSuggestions 2" in social.calls)
            assertEquals(listOf("s1", "s2", "s3"), model.shown())
            assertNull(model.state.value.suggestionsNext)
            social.calls.clear()
            model.moreSuggestions()
            advanceUntilIdle()
            assertTrue(pageReads().isEmpty())
        }

    @Test
    fun anAskedPersonLeavesTheSectionAtOnce() =
        runTest(dispatcher) {
            val model = model()
            assertTrue("s1" in model.shown())
            model.ask("s1")
            advanceUntilIdle()
            assertTrue("sendFriendRequest s1" in social.calls)
            assertTrue("s1" !in model.shown())
            assertEquals(listOf("s2"), model.shown())
            val sent = model.state.value.sent
            assertEquals(listOf("s1"), sent.map { it.person.accountId })
        }

    @Test
    fun aFailedAskKeepsThePersonAndShowsTheProblem() =
        runTest(dispatcher) {
            val model = model()
            assertTrue("s1" in model.shown())
            social.failOn = "sendFriendRequest s1"
            model.ask("s1")
            advanceUntilIdle()
            assertTrue("sendFriendRequest s1" in social.calls)
            assertTrue("s1" in model.shown())
            assertNotNull(model.state.value.problem)
        }
}
