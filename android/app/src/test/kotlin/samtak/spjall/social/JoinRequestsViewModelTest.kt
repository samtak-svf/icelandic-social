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
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import samtak.spjall.account.Problem
import samtak.spjall.core.CommunityAudience
import samtak.spjall.core.CommunityInvitation
import samtak.spjall.core.CommunityRole
import samtak.spjall.core.InvitedBy
import samtak.spjall.core.JoinRequest

@OptIn(ExperimentalCoroutinesApi::class)
class JoinRequestsViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val social = FakeSocial()

    @Before fun main() = Dispatchers.setMain(dispatcher)

    @After fun reset() = Dispatchers.resetMain()

    @Before fun waiting() {
        social.communities["k1"] =
            community("k1", audience = CommunityAudience.PRIVATE, role = CommunityRole.OWNER, pendingJoinRequests = 2uL)
        social.requests["k1"] =
            mutableListOf(JoinRequest("a2", "Anna", true, 1uL), JoinRequest("a3", null, false, 2uL))
    }

    private fun TestScope.model() = JoinRequestsViewModel("k1", social, dispatcher).also { advanceUntilIdle() }

    @Test
    fun listsTheRequestsThatWait() =
        runTest(dispatcher) {
            val state = model().state.value
            assertEquals(listOf("a2", "a3"), state.requests.map { it.accountId })
            assertTrue(state.loaded)
        }

    @Test
    fun approvingAnswersItAndAsksForTheListAgain() =
        runTest(dispatcher) {
            val model = model()
            model.approve("a2")
            advanceUntilIdle()
            assertTrue("approveJoinRequest k1 a2" in social.calls)
            assertEquals(
                listOf("a3"),
                model.state.value.requests
                    .map { it.accountId },
            )
            assertFalse(model.state.value.busy)
        }

    @Test
    fun decliningAnswersItAndAsksForTheListAgain() =
        runTest(dispatcher) {
            val model = model()
            model.decline("a3")
            advanceUntilIdle()
            assertTrue("declineJoinRequest k1 a3" in social.calls)
            assertEquals(
                listOf("a2"),
                model.state.value.requests
                    .map { it.accountId },
            )
        }

    @Test
    fun aRequestAnotherModeratorAnsweredIsNamedAsGone() =
        runTest(dispatcher) {
            val model = model()
            model.approve("a9")
            advanceUntilIdle()
            assertEquals(Problem.NotFound, model.state.value.problem)
        }

    @Test
    fun anEmptyListIsLoadedNotPending() =
        runTest(dispatcher) {
            social.requests["k1"] = mutableListOf()
            val state = model().state.value
            assertTrue(state.requests.isEmpty())
            assertTrue(state.loaded)
        }

    @Test
    fun theInvitationsThatWaitComeWithTheRequests() =
        runTest(dispatcher) {
            social.invitations["k1"] =
                mutableListOf(
                    CommunityInvitation("a4", "Bjarni", InvitedBy("a1", "Ég"), 3uL),
                    CommunityInvitation("a5", null, null, 4uL),
                )
            val state = model().state.value
            assertEquals(listOf("a4", "a5"), state.invitations.map { it.accountId })
            assertEquals(null, state.invitations[1].invitedBy)
        }

    @Test
    fun noInvitationsLeavesTheListEmpty() =
        runTest(dispatcher) {
            val state = model().state.value
            assertTrue(state.invitations.isEmpty())
        }

    @Test
    fun withdrawingAnInvitationTakesItBackAndAsksForTheListsAgain() =
        runTest(dispatcher) {
            social.invitations["k1"] = mutableListOf(CommunityInvitation("a4", "Bjarni", null, 3uL))
            val model = model()
            model.withdraw("a4")
            advanceUntilIdle()
            assertTrue("withdrawInvitation k1 a4" in social.calls)
            val state = model.state.value
            assertTrue(state.invitations.isEmpty())
            assertEquals(listOf("a2", "a3"), state.requests.map { it.accountId })
            assertFalse(model.state.value.busy)
        }

    @Test
    fun anInvitationAnotherModeratorWithdrewIsNamedAsGone() =
        runTest(dispatcher) {
            social.invitations["k1"] = mutableListOf()
            val model = model()
            model.withdraw("a9")
            advanceUntilIdle()
            assertEquals(Problem.NotFound, model.state.value.problem)
        }
}
