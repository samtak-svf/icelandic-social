package samtak.spjall.feed

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import samtak.spjall.account.FakeAccount
import samtak.spjall.account.Problem
import samtak.spjall.conversations.Outgoing
import samtak.spjall.conversations.PickViewModel
import samtak.spjall.socket.FakeLive
import samtak.spjall.socket.conversation
import samtak.spjall.socket.person

/** "Senda í samtal": a post shared through the conversation picker (decision 0040). */
@OptIn(ExperimentalCoroutinesApi::class)
class SharePostTest {
    private val dispatcher = StandardTestDispatcher()
    private val account = FakeAccount(signedIn = true)
    private val live = FakeLive()

    @Before fun main() = Dispatchers.setMain(dispatcher)

    @After fun reset() = Dispatchers.resetMain()

    private fun TestScope.model() =
        PickViewModel(account, live, io = dispatcher, preview = sharedPreview("p1"), deliver = sharing("p1")).also {
            advanceUntilIdle()
        }

    private val shares get() = account.calls.filter { it.startsWith("sharePost") }

    @Test
    fun eachPickedConversationGetsTheIdOfThePostThenOneSync() =
        runTest(dispatcher) {
            account.conversations = listOf(conversation("c1"), conversation("c2"), conversation("c3"))
            val model = model()
            val done = mutableListOf<Int>()
            backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { model.done.collect(done::add) }
            // A post comes from no conversation, so every one is offered.
            assertEquals(
                listOf("c1", "c2", "c3"),
                model.state.value.conversations
                    .map { it.id },
            )
            model.toggle("c3")
            model.toggle("c1")
            model.send()
            advanceUntilIdle()
            assertEquals(listOf("sharePost c1 p1", "sharePost c3 p1"), shares)
            assertEquals(1, live.syncs)
            assertEquals(listOf(2), done)
        }

    @Test
    fun aFailedShareKeepsWhatWasNotSentPickedAndSendsNothingTwice() =
        runTest(dispatcher) {
            account.conversations = listOf(conversation("c1"), conversation("c2"))
            val model = model()
            model.toggle("c1")
            model.toggle("c2")
            account.failOn = "sharePost c2 p1"
            model.send()
            advanceUntilIdle()
            assertEquals(Problem.Unreachable, model.state.value.problem)
            assertEquals(setOf("c2"), model.state.value.picked)
            assertEquals(1, live.syncs)
            account.failOn = null
            model.send()
            advanceUntilIdle()
            assertEquals(listOf("sharePost c1 p1", "sharePost c2 p1", "sharePost c2 p1"), shares)
        }

    @Test
    fun showsThePostBeingSharedAsTheServerHoldsIt() =
        runTest(dispatcher) {
            val shared = FakeAccount.post("p1", person("a2", "Anna"), "Fundur í kvöld")
            account.posts += shared
            assertEquals(Outgoing.SharedPost(shared), model().state.value.outgoing)
        }

    @Test
    fun aPostNoLongerShownSaysOnlyThat() =
        runTest(dispatcher) {
            assertEquals(Outgoing.PostGone, model().state.value.outgoing)
        }
}
