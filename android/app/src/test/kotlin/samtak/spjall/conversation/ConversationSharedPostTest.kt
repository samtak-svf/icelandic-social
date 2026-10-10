package samtak.spjall.conversation

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import samtak.spjall.account.FakeAccount
import samtak.spjall.account.unreachable
import samtak.spjall.conversation.ConversationViewModel.Shared
import samtak.spjall.socket.FakeLive
import samtak.spjall.socket.conversation
import samtak.spjall.socket.person

/** The card of a Fljótið post shared into a conversation (decision 0040). */
@OptIn(ExperimentalCoroutinesApi::class)
class ConversationSharedPostTest {
    private val dispatcher = StandardTestDispatcher()
    private val account = FakeAccount(signedIn = true)
    private val live = FakeLive(account)
    private val anna = person("a2", "Anna")

    @Before fun main() = Dispatchers.setMain(dispatcher)

    @After fun reset() = Dispatchers.resetMain()

    private fun TestScope.model(): ConversationViewModel {
        account.conversations = listOf(conversation("c1", anna))
        return ConversationViewModel("c1", account, live, dispatcher).also { runCurrent() }
    }

    private fun fetches(postId: String) = account.calls.count { it == "sharedPost $postId" }

    @Test
    fun aSharedPostIsFetchedOnceForTheScreen() =
        runTest(dispatcher) {
            val post = FakeAccount.post("p1", anna, "Góðan dag")
            account.posts += post
            val model = model()
            model.showPost("p1")
            model.showPost("p1")
            advanceUntilIdle()
            assertEquals(Shared.Found(post), model.state.value.posts["p1"])
            model.showPost("p1")
            advanceUntilIdle()
            assertEquals(1, fetches("p1"))
        }

    @Test
    fun aGonePostIsSaidOnceAndNotAskedForAgain() =
        runTest(dispatcher) {
            val model = model()
            model.showPost("p9")
            advanceUntilIdle()
            assertEquals(Shared.Gone, model.state.value.posts["p9"])
            model.showPost("p9")
            advanceUntilIdle()
            assertEquals(1, fetches("p9"))
        }

    @Test
    fun aFailedFetchCanBeAskedForAgain() =
        runTest(dispatcher) {
            val post = FakeAccount.post("p1", anna)
            account.posts += post
            val model = model()
            advanceUntilIdle()
            account.failNext = unreachable()
            model.showPost("p1")
            advanceUntilIdle()
            assertEquals(Shared.Failed, model.state.value.posts["p1"])
            model.showPost("p1")
            advanceUntilIdle()
            assertEquals(Shared.Found(post), model.state.value.posts["p1"])
        }
}
