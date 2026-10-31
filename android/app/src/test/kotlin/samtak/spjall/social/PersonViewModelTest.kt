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
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import samtak.spjall.account.Problem
import samtak.spjall.core.CoreException
import samtak.spjall.core.Relation

@OptIn(ExperimentalCoroutinesApi::class)
class PersonViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val social = FakeSocial()

    @Before fun main() = Dispatchers.setMain(dispatcher)

    @After fun reset() = Dispatchers.resetMain()

    @Before fun anna() {
        social.people["a2"] = profile(anna)
    }

    private fun TestScope.model() = PersonViewModel("a2", social, dispatcher).also { advanceUntilIdle() }

    private fun PersonViewModel.relation() = state.value.profile?.relation

    @Test
    fun readsThePersonAndHowSheStandsToThisAccount() =
        runTest(dispatcher) {
            val model = model()
            assertEquals(Relation.NONE, model.relation())
            assertTrue(model.state.value.loaded)
        }

    @Test
    fun addingAsksAndShowsTheRequestAsSent() =
        runTest(dispatcher) {
            val model = model()
            model.add()
            advanceUntilIdle()
            assertTrue("sendFriendRequest a2" in social.calls)
            assertEquals(Relation.SENT, model.relation())
        }

    @Test
    fun cancellingATakesTheRequestBack() =
        runTest(dispatcher) {
            social.people["a2"] = profile(anna, Relation.SENT)
            val model = model()
            model.cancel()
            advanceUntilIdle()
            assertTrue("cancelFriendRequest a2" in social.calls)
            assertEquals(Relation.NONE, model.relation())
        }

    @Test
    fun acceptingMakesThemFriendsAndDecliningDoesNot() =
        runTest(dispatcher) {
            social.people["a2"] = profile(anna, Relation.INCOMING)
            val accepted = model()
            accepted.accept()
            advanceUntilIdle()
            assertEquals(Relation.FRIENDS, accepted.relation())
            social.people["a2"] = profile(anna, Relation.INCOMING)
            val declined = model()
            declined.decline()
            advanceUntilIdle()
            assertTrue("declineFriendRequest a2" in social.calls)
            assertEquals(Relation.NONE, declined.relation())
        }

    @Test
    fun endingAFriendshipEndsIt() =
        runTest(dispatcher) {
            social.people["a2"] = profile(anna, Relation.FRIENDS, friendsSince = 5uL)
            val model = model()
            model.end()
            advanceUntilIdle()
            assertTrue("endFriendship a2" in social.calls)
            assertEquals(Relation.NONE, model.relation())
        }

    @Test
    fun snoozingShowsUntilWhenAndUnsnoozingClearsIt() =
        runTest(dispatcher) {
            val model = model()
            model.snooze()
            advanceUntilIdle()
            val snoozed = model.state.value.profile
            assertEquals(1_800_000_000_000uL, snoozed?.snoozedUntil)
            model.unsnooze()
            advanceUntilIdle()
            val unsnoozed = model.state.value.profile
            assertNull(unsnoozed?.snoozedUntil)
        }

    @Test
    fun anAccountThatIsNotThereIsNamedAsGone() =
        runTest(dispatcher) {
            val model = PersonViewModel("nobody", social, dispatcher)
            advanceUntilIdle()
            assertEquals(Problem.NotFound, model.state.value.problem)
            assertTrue(model.state.value.loaded)
        }

    @Test
    fun aRefusedRequestIsNamedAndTheProfileStays() =
        runTest(dispatcher) {
            val model = model()
            social.failNext = CoreException.Refused(409u, "request_refused", null)
            model.add()
            advanceUntilIdle()
            assertEquals(Problem.RequestRefused, model.state.value.problem)
            assertEquals(Relation.NONE, model.relation())
            assertFalse(model.state.value.busy)
        }

    @Test
    fun theLimitsHaveTheirOwnProblems() =
        runTest(dispatcher) {
            val model = model()
            social.failNext = CoreException.Refused(429u, "request_limit", null)
            model.add()
            advanceUntilIdle()
            assertEquals(Problem.RequestLimit, model.state.value.problem)
            social.failNext = CoreException.Refused(409u, "friend_limit", null)
            model.retry()
            advanceUntilIdle()
            assertEquals(Problem.FriendLimit, model.state.value.problem)
        }
}
