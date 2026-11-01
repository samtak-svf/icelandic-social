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
import samtak.spjall.brand.R
import samtak.spjall.core.CommunityRole

/** Who gets the comment box on a post, and what a member without one reads there instead. */
@OptIn(ExperimentalCoroutinesApi::class)
class PostNoReplyNoticeTest {
    private val dispatcher = StandardTestDispatcher()
    private val social = FakeSocial()

    @Before fun main() = Dispatchers.setMain(dispatcher)

    @After fun reset() = Dispatchers.resetMain()

    @Before fun post() {
        social.posts["k1"] = mutableListOf(post("p1"))
        social.comments["p1"] = mutableListOf()
    }

    private fun TestScope.state(): PostViewModel.State =
        PostViewModel("p1", social, dispatcher).also { advanceUntilIdle() }.state.value

    @Test
    fun aMemberWrites() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1", role = CommunityRole.MEMBER)
            val state = state()
            assertTrue(state.writes)
            assertNull(state.noPostNotice)
        }

    @Test
    fun aMemberOfAReadOnlyCommunityReadsWhy() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1", role = CommunityRole.MEMBER).copy(readOnly = true)
            val state = state()
            assertFalse(state.writes)
            assertEquals(R.string.community_read_only, state.noPostNotice)
        }

    @Test
    fun whoeverHasNotJoinedReadsNoReason() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1")
            val state = state()
            assertFalse(state.writes)
            assertNull(state.noPostNotice)
        }
}
