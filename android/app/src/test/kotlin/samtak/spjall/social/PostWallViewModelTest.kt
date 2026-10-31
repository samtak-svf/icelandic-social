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
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** A post on a wall (0115): no community behind it, and its owner removes a comment with a reason. */
@OptIn(ExperimentalCoroutinesApi::class)
class PostWallViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val social = FakeSocial()

    @Before fun main() = Dispatchers.setMain(dispatcher)

    @After fun reset() = Dispatchers.resetMain()

    @Before fun wallPost() {
        val mine = post("w1", communityId = "w-a1", author = self)
        social.posts["w-a1"] = mutableListOf(mine.copy(wallOwner = self.accountId))
        social.comments["w1"] = mutableListOf(comment("c1", "w1"))
    }

    private fun TestScope.model() = PostViewModel("w1", social, dispatcher).also { advanceUntilIdle() }

    @Test
    fun aWallPostReadsNoCommunityAndStaysWritable() =
        runTest(dispatcher) {
            val state = model().state.value
            assertEquals("w1", state.post?.postId)
            assertTrue(state.writes)
            assertTrue(social.calls.none { it.startsWith("community") })
        }

    @Test
    fun theOwnerRemovesAnotherPersonsCommentWithAReason() =
        runTest(dispatcher) {
            val model = model()
            model.deleteComment("c1", "Meiðyrði")
            advanceUntilIdle()
            assertTrue("removeWallComment c1 Meiðyrði" in social.calls)
            val left = model.state.value.comments
            assertTrue(left.isEmpty())
        }
}
