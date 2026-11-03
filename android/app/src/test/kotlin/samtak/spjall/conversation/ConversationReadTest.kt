package samtak.spjall.conversation

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import samtak.spjall.account.FakeAccount
import samtak.spjall.core.Event
import samtak.spjall.socket.FakeLive
import samtak.spjall.socket.conversation
import samtak.spjall.socket.item
import samtak.spjall.socket.person

/** When the conversation's view model marks it read: only what a person saw, and only forward (#554). */
@OptIn(ExperimentalCoroutinesApi::class)
class ConversationReadTest {
    private val dispatcher = StandardTestDispatcher()
    private val account = FakeAccount(signedIn = true)
    private val live = FakeLive(account)

    @Before fun main() = Dispatchers.setMain(dispatcher)

    @After fun reset() = Dispatchers.resetMain()

    /** A model whose screen is in front, as `ON_START` leaves it, unless [shown] is false. */
    private fun TestScope.model(shown: Boolean = true): ConversationViewModel {
        account.conversations = listOf(conversation("c1", person("a2", "Anna")))
        return ConversationViewModel("c1", account, live, Drafts(), dispatcher, { _, _ -> }) {
            FakeAccount.NOW.toLong() + testScheduler.currentTime
        }.also {
            if (shown) it.shown()
            runCurrent()
        }
    }

    private fun marks() = account.calls.filter { it.startsWith("markRead") }

    private suspend fun TestScope.arrives(seq: ULong) {
        account.timelines.getValue("c1") += item(seq)
        live.events.emit(Event.Timeline("c1", listOf(seq)))
        runCurrent()
    }

    @Test
    fun marksReadOnlyWhenTheNewestAdvanced() =
        runTest(dispatcher) {
            account.timelines["c1"] = mutableListOf(item(1u))
            val model = model()
            model.load()
            runCurrent()
            assertEquals(listOf("markRead c1 1"), marks())
            arrives(2u)
            assertEquals(listOf("markRead c1 1", "markRead c1 2"), marks())
        }

    @Test
    fun aMessageThatArrivesWhileTheScreenIsStoppedIsLoadedButNotRead() =
        runTest(dispatcher) {
            account.timelines["c1"] = mutableListOf(item(1u))
            val model = model()
            model.paused()
            arrives(2u)
            val state = model.state.value
            assertEquals(listOf(1uL, 2uL), state.items.map { it.seq })
            assertEquals("nobody saw it, so the sender is not told it was read", listOf("markRead c1 1"), marks())
            model.shown()
            runCurrent()
            assertEquals(listOf("markRead c1 1", "markRead c1 2"), marks())
        }

    @Test
    fun nothingIsReadBeforeTheScreenStarts() =
        runTest(dispatcher) {
            account.timelines["c1"] = mutableListOf(item(1u))
            val model = model(shown = false)
            assertTrue(model.state.value.loaded)
            assertEquals(emptyList<String>(), marks())
            assertEquals(0, live.syncs)
            model.shown()
            runCurrent()
            assertEquals(listOf("markRead c1 1"), marks())
            assertEquals(1, live.syncs)
        }
}
