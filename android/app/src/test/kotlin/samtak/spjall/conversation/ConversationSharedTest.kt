package samtak.spjall.conversation

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
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
import samtak.spjall.core.Content
import samtak.spjall.core.Event
import samtak.spjall.socket.FakeLive
import samtak.spjall.socket.conversation
import samtak.spjall.socket.item
import samtak.spjall.socket.person

/** The photos and files the information screen lists (0055), on the conversation's own view model. */
@OptIn(ExperimentalCoroutinesApi::class)
class ConversationSharedTest {
    private val dispatcher = StandardTestDispatcher()
    private val account = FakeAccount(signedIn = true)
    private val live = FakeLive(account)
    private val drafts = Drafts()

    @Before fun main() = Dispatchers.setMain(dispatcher)

    @After fun reset() = Dispatchers.resetMain()

    private fun TestScope.model(): ConversationViewModel {
        account.conversations = listOf(conversation("c1", person("a2", "Anna")))
        return ConversationViewModel("c1", account, live, drafts, dispatcher, { _, _ -> }) {
            FakeAccount.NOW.toLong() + testScheduler.currentTime
        }.also { runCurrent() }
    }

    private fun photo(seq: ULong) = item(seq, content = Content.Media("image/jpeg", 10uL, null, null))

    private fun file(seq: ULong) = item(seq, content = Content.Media("application/pdf", 10uL, null, "skýrsla.pdf"))

    private fun shared(model: ConversationViewModel) = model.state.value.shared

    @Test
    fun theConversationAloneAsksForNoPhotosOrFiles() =
        runTest(dispatcher) {
            account.timelines["c1"] = mutableListOf(photo(1u))
            val model = model()
            assertNull(shared(model))
            assertTrue(account.calls.none { it.startsWith("shared") })
        }

    @Test
    fun theInformationScreenListsThemNewestFirst() =
        runTest(dispatcher) {
            account.timelines["c1"] = mutableListOf(photo(1u), item(2u), file(3u), photo(4u))
            val model = model()
            model.loadShared()
            runCurrent()
            val shared = shared(model)!!
            assertTrue(shared.loaded)
            assertEquals(listOf(4uL, 3uL, 1uL), shared.items.map { it.seq })
            assertFalse("a short page is all of them", shared.more)
        }

    @Test
    fun anEventForTheConversationReadsThemAgain() =
        runTest(dispatcher) {
            account.timelines["c1"] = mutableListOf(photo(1u))
            val model = model()
            model.loadShared()
            runCurrent()
            account.timelines.getValue("c1") += file(2u)
            live.events.emit(Event.Timeline("c1", listOf(2uL)))
            runCurrent()
            assertEquals(listOf(2uL, 1uL), shared(model)!!.items.map { it.seq })
            // An item gone under its timer is gone here too.
            account.timelines.getValue("c1").removeAll { it.seq == 1uL }
            live.events.emit(Event.Expired("c1", listOf(1uL)))
            runCurrent()
            assertEquals(listOf(2uL), shared(model)!!.items.map { it.seq })
        }

    @Test
    fun olderOnesComeAPageAtATime() =
        runTest(dispatcher) {
            account.timelines["c1"] = (1u..70u).map { photo(it.toULong()) }.toMutableList()
            val model = model()
            model.loadShared()
            runCurrent()
            assertEquals(50, shared(model)!!.items.size)
            assertTrue(shared(model)!!.more)
            model.moreShared()
            runCurrent()
            val shared = shared(model)!!
            assertEquals((70u downTo 1u).map { it.toULong() }, shared.items.map { it.seq })
            assertFalse(shared.more)
            assertTrue("shared c1 21" in account.calls)
        }

    @Test
    fun aTapOpensTheFileThroughTheConversationsOwnPath() =
        runTest(dispatcher) {
            val pdf = file(3u)
            account.timelines["c1"] = mutableListOf(pdf)
            account.files["c1" to 3uL] = "/files/3"
            val model = model()
            model.loadShared()
            runCurrent()
            val opened = async { model.opened.first() }
            model.open(shared(model)!!.items.single())
            runCurrent()
            assertEquals(Opened("/files/3", "application/pdf", "skýrsla.pdf"), opened.await())
            assertEquals(ConversationViewModel.Media.Ready("/files/3"), model.state.value.media[3uL])
        }
}
