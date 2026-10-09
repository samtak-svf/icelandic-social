package samtak.spjall.feed

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
import samtak.spjall.account.FakeAccount
import samtak.spjall.account.FakeAccount.Companion.ME
import samtak.spjall.account.FakeAccount.Companion.NOW
import samtak.spjall.account.FakeAccount.Companion.post
import samtak.spjall.core.Person
import samtak.spjall.core.Reply

@OptIn(ExperimentalCoroutinesApi::class)
class RepliesViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val account = FakeAccount(signedIn = true)
    private val anna = Person("a2", "Anna Jónsdóttir", false)

    @Before fun main() = Dispatchers.setMain(dispatcher)

    @After fun reset() = Dispatchers.resetMain()

    private fun TestScope.model(postId: String = "p1") =
        RepliesViewModel(postId, account, dispatcher).also { advanceUntilIdle() }

    private fun ids(model: RepliesViewModel) =
        model.state.value.replies
            .map { it.replyId }

    @Test
    fun showsThePostAndItsRepliesOldestFirst() =
        runTest(dispatcher) {
            account.posts += post("p1", anna, replies = 2u)
            account.replies["p1"] =
                mutableListOf(Reply("r1", "p1", ME, "Fyrst", NOW), Reply("r2", "p1", anna, "Svo", NOW))
            val model = model()
            assertEquals(
                "p1",
                model.state.value.post
                    ?.postId,
            )
            assertEquals(listOf("r1", "r2"), ids(model))
            assertEquals("a1", model.state.value.me)
        }

    @Test
    fun aReplyIsAddedAtTheEndAndCounted() =
        runTest(dispatcher) {
            account.posts += post("p1", anna)
            val model = model()
            model.send("  ")
            advanceUntilIdle()
            assertTrue(account.calls.none { it.startsWith("createReply") })
            model.send(" Takk ")
            advanceUntilIdle()
            assertEquals(
                "Takk",
                model.state.value.replies
                    .single()
                    .body,
            )
            assertEquals(
                1u,
                model.state.value.post
                    ?.replyCount,
            )
        }

    @Test
    fun deletingAReplyRemovesIt() =
        runTest(dispatcher) {
            account.posts += post("p1", anna, replies = 1u)
            account.replies["p1"] = mutableListOf(Reply("r1", "p1", ME, "Fyrst", NOW))
            val model = model()
            model.delete("r1")
            advanceUntilIdle()
            assertTrue(
                model.state.value.replies
                    .isEmpty(),
            )
            assertEquals(
                0u,
                model.state.value.post
                    ?.replyCount,
            )
        }

    @Test
    fun aPostThatIsGoneEndsTheScreen() =
        runTest(dispatcher) {
            val model = model("p9")
            assertTrue(model.state.value.gone)
        }

    @Test
    fun deletingThePostEndsTheScreen() =
        runTest(dispatcher) {
            account.posts += post("p1", ME)
            val model = model()
            assertFalse(model.state.value.gone)
            model.deletePost()
            advanceUntilIdle()
            assertTrue(model.state.value.gone)
            assertTrue(account.posts.isEmpty())
        }
}
