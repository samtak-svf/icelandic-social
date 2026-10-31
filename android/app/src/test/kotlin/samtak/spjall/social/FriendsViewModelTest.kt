package samtak.spjall.social

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import samtak.spjall.core.Author
import samtak.spjall.core.FriendSort
import samtak.spjall.core.Relation

@OptIn(ExperimentalCoroutinesApi::class)
class FriendsViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val social = FakeSocial()
    private val bjorn = Author("a3", "Björn", false)
    private val dora = Author("a4", "Dóra", true)
    private val eir = Author("a5", "Eir", true)

    @Before fun main() = Dispatchers.setMain(dispatcher)

    @After fun reset() = Dispatchers.resetMain()

    @Before fun people() {
        social.people["a2"] = profile(anna, Relation.FRIENDS, friendsSince = 10uL)
        social.people["a3"] = profile(bjorn, Relation.FRIENDS, friendsSince = 30uL)
        social.people["a4"] = profile(dora, Relation.INCOMING)
        social.people["a5"] = profile(eir, Relation.SENT)
    }

    private fun TestScope.model() = FriendsViewModel(social, dispatcher).also { advanceUntilIdle() }

    private fun FriendsViewModel.friendIds() = state.value.friends.map { it.person.accountId }

    @Test
    fun readsTheFriendsTheRequestsAndTheSnoozes() =
        runTest(dispatcher) {
            social.snoozedUntil["a3"] = 99uL
            val state = model().state.value
            assertEquals(2uL, state.count)
            assertEquals(listOf("a3", "a2"), state.friends.map { it.person.accountId })
            assertEquals(listOf("a4"), state.incoming.map { it.person.accountId })
            assertEquals(listOf("a5"), state.sent.map { it.person.accountId })
            assertEquals(listOf("a3"), state.snoozes.map { it.person.accountId })
        }

    @Test
    fun sortingByNameAsksForItAndOrdersByName() =
        runTest(dispatcher) {
            val model = model()
            model.sortBy(FriendSort.NAME)
            advanceUntilIdle()
            assertTrue("friends NAME" in social.calls)
            assertEquals(listOf("a2", "a3"), model.friendIds())
        }

    @Test
    fun theSearchWaitsForTypingToPauseAndThenNarrowsTheList() =
        runTest(dispatcher) {
            val model = model()
            social.calls.clear()
            model.onQuery("Bj")
            advanceTimeBy(100)
            assertTrue(social.calls.none { it.startsWith("friends") })
            advanceUntilIdle()
            assertTrue("friends NEWEST Bj" in social.calls)
            assertEquals(listOf("a3"), model.friendIds())
        }

    @Test
    fun acceptingAnswersTheRequestAndTheFriendJoinsTheList() =
        runTest(dispatcher) {
            val model = model()
            model.accept("a4")
            advanceUntilIdle()
            assertTrue("acceptFriendRequest a4" in social.calls)
            assertTrue("a4" in model.friendIds())
            val after = model.state.value
            assertTrue(after.incoming.isEmpty())
        }

    @Test
    fun decliningAndCancellingEmptyTheirLists() =
        runTest(dispatcher) {
            val model = model()
            model.decline("a4")
            advanceUntilIdle()
            model.cancel("a5")
            advanceUntilIdle()
            assertTrue("declineFriendRequest a4" in social.calls && "cancelFriendRequest a5" in social.calls)
            val after = model.state.value
            assertTrue(after.incoming.isEmpty() && after.sent.isEmpty())
        }

    @Test
    fun unsnoozingDropsThePersonFromTheSnoozes() =
        runTest(dispatcher) {
            social.snoozedUntil["a3"] = 99uL
            val model = model()
            model.unsnooze("a3")
            advanceUntilIdle()
            assertTrue("unsnoozePerson a3" in social.calls)
            val after = model.state.value
            assertTrue(after.snoozes.isEmpty())
        }

    @Test
    fun aFailedReadIsNamedAndRetryAsksAgain() =
        runTest(dispatcher) {
            social.failNext = notFound()
            val model = FriendsViewModel(social, dispatcher)
            advanceUntilIdle()
            assertTrue(model.state.value.problem != null)
            assertFalse(model.state.value.busy)
            model.retry()
            advanceUntilIdle()
            assertEquals(null, model.state.value.problem)
            assertEquals(2, model.state.value.friends.size)
        }
}
