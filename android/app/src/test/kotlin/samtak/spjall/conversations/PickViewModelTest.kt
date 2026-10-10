package samtak.spjall.conversations

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
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import samtak.spjall.account.FakeAccount
import samtak.spjall.account.Problem
import samtak.spjall.account.unreachable
import samtak.spjall.core.ConversationState
import samtak.spjall.socket.FakeLive
import samtak.spjall.socket.conversation
import samtak.spjall.socket.person

@OptIn(ExperimentalCoroutinesApi::class)
class PickViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val account = FakeAccount(signedIn = true)
    private val live = FakeLive()

    @Before fun main() = Dispatchers.setMain(dispatcher)

    @After fun reset() = Dispatchers.resetMain()

    /** A forward of seq 7 out of c1, as the conversation screen asks for it (decision 0041). */
    private fun TestScope.model() =
        PickViewModel(account, live, except = "c1", io = dispatcher) { to -> forward("c1", 7uL, to) }
            .also { advanceUntilIdle() }

    @Test
    fun offersEveryConversationItCanSendIntoButTheOneItCameFrom() =
        runTest(dispatcher) {
            account.conversations =
                listOf(
                    conversation("c1", person("a2", "Anna")),
                    conversation("c2", person("a3", "Björn")),
                    conversation("c3", person("a4", "Dóra"), state = ConversationState.REMOVED),
                    conversation("c4", person("a5", "Elín"), state = ConversationState.NEW),
                )
            val model = model()
            assertEquals(
                listOf("c2", "c4"),
                model.state.value.conversations
                    .map { it.id },
            )
            assertTrue(model.state.value.loaded)
        }

    @Test
    fun sendsOneCopyIntoEachPickedConversationThenSaysHowMany() =
        runTest(dispatcher) {
            account.conversations = listOf(conversation("c2"), conversation("c3"), conversation("c4"))
            val model = model()
            val done = mutableListOf<Int>()
            backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { model.done.collect(done::add) }
            assertFalse(model.state.value.canSend)
            model.toggle("c4")
            model.toggle("c2")
            model.toggle("c3")
            model.toggle("c3")
            assertEquals(setOf("c4", "c2"), model.state.value.picked)
            assertTrue(model.state.value.canSend)
            model.send()
            advanceUntilIdle()
            // In the list's order, not the order they were picked in.
            assertEquals(
                listOf("forward c1 7 c2", "forward c1 7 c4"),
                account.calls.filter { it.startsWith("forward") },
            )
            assertEquals(1, live.syncs)
            assertEquals(listOf(2), done)
        }

    @Test
    fun aFailedForwardKeepsOnlyWhatWasNotSentPickedSoTryingAgainSendsNoCopyTwice() =
        runTest(dispatcher) {
            account.conversations = listOf(conversation("c2"), conversation("c3"))
            val model = model()
            val done = mutableListOf<Int>()
            backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { model.done.collect(done::add) }
            model.toggle("c2")
            model.toggle("c3")
            account.failOn = "forward c1 7 c3"
            model.send()
            advanceUntilIdle()
            assertEquals(Problem.Unreachable, model.state.value.problem)
            assertEquals(setOf("c3"), model.state.value.picked)
            assertFalse(model.state.value.sending)
            assertEquals(emptyList<Int>(), done)
            // What did go is sent, even though the rest failed.
            assertEquals(1, live.syncs)

            account.failOn = null
            model.send()
            advanceUntilIdle()
            assertNull(model.state.value.problem)
            assertEquals(
                listOf("forward c1 7 c2", "forward c1 7 c3", "forward c1 7 c3"),
                account.calls.filter { it.startsWith("forward") },
            )
            assertEquals(listOf(2), done)
        }

    @Test
    fun nothingPickedSendsNothing() =
        runTest(dispatcher) {
            account.conversations = listOf(conversation("c2"))
            val model = model()
            model.send()
            advanceUntilIdle()
            assertTrue(account.calls.none { it.startsWith("forward") })
            assertEquals(0, live.syncs)
        }

    @Test
    fun aFailedReadIsAProblemThatRetryClears() =
        runTest(dispatcher) {
            account.failNext = unreachable()
            val model = model()
            assertEquals(Problem.Unreachable, model.state.value.problem)
            model.retry()
            advanceUntilIdle()
            assertNull(model.state.value.problem)
        }
}
