package samtak.spjall.social

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
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
import samtak.spjall.core.ModerationState

/** A removed post as a reader who may not read it gets it (0115). */
@OptIn(ExperimentalCoroutinesApi::class)
class PostTombstoneTest {
    private val dispatcher = StandardTestDispatcher()
    private val social = FakeSocial()
    private val tombstone = post("p1", body = "", author = null, state = ModerationState.REMOVED)

    @Before fun main() = Dispatchers.setMain(dispatcher)

    @After fun reset() = Dispatchers.resetMain()

    @Test
    fun onlyAnEmptyRemovedPostIsOne() {
        assertTrue(tombstone.isTombstone())
        assertFalse(post("p1", state = ModerationState.REMOVED).isTombstone())
        assertFalse(post("p1", body = "", author = null).isTombstone())
        val anonymous = post("p1", body = "", author = null, anonymous = true, state = ModerationState.REMOVED)
        assertFalse(anonymous.isTombstone())
    }

    @Test
    fun itsScreenAsksForNoCommentsAndWritesNothing() =
        runTest(dispatcher) {
            // The comments' route refuses this reader, and the community may be one they left.
            social.posts["k1"] = mutableListOf(tombstone)
            val model = PostViewModel("p1", social, dispatcher)
            advanceUntilIdle()
            val state = model.state.value
            assertNull(state.problem)
            assertEquals(tombstone, state.post)
            assertTrue(state.comments.isEmpty())
            assertFalse(state.writes)
            assertFalse(social.calls.any { it.startsWith("comments ") || it.startsWith("community ") })
        }
}
