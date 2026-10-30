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
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import samtak.spjall.core.CommunityAudience
import samtak.spjall.core.CommunityMember
import samtak.spjall.core.CommunityRole

/** The member list follows the account's own join and leave, not the screen's next recreation. */
@OptIn(ExperimentalCoroutinesApi::class)
class CommunityMembersAfterJoinTest {
    private val dispatcher = StandardTestDispatcher()
    private val social = FakeSocial()

    @Before fun main() = Dispatchers.setMain(dispatcher)

    @After fun reset() = Dispatchers.resetMain()

    private fun TestScope.model() = CommunityViewModel("k1", social, { NOW }, dispatcher).also { advanceUntilIdle() }

    private fun member(id: String) = CommunityMember(id, id, true, CommunityRole.MEMBER, 1uL, null)

    @Test
    fun joiningAnOpenCommunityListsTheNewMember() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1")
            social.members["k1"] = mutableListOf(member("a2"))
            val model = model()
            model.loadMembers()
            advanceUntilIdle()
            assertEquals(1, model.state.value.members.size)
            social.members["k1"]!!.add(member("a3"))
            model.join()
            advanceUntilIdle()
            assertEquals(2, model.state.value.members.size)
        }

    @Test
    fun leavingAPrivateCommunityEmptiesTheListWithoutAnError() =
        runTest(dispatcher) {
            social.communities["k1"] =
                community("k1", role = CommunityRole.MEMBER, audience = CommunityAudience.PRIVATE)
            social.members["k1"] = mutableListOf(member("a2"))
            val model = model()
            model.loadMembers()
            advanceUntilIdle()
            assertEquals(1, model.state.value.members.size)
            model.leave()
            advanceUntilIdle()
            assertTrue(
                model.state.value.members
                    .isEmpty(),
            )
            assertNull(
                model.state.value
                    .problem,
            )
        }
}

private const val NOW = 1_800_000_000_000L
