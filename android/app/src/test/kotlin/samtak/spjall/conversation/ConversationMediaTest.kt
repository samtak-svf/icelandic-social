package samtak.spjall.conversation

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
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
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import samtak.spjall.account.FakeAccount
import samtak.spjall.account.Problem
import samtak.spjall.account.unreachable
import samtak.spjall.conversation.ConversationViewModel.Media
import samtak.spjall.core.Content
import samtak.spjall.socket.FakeLive
import samtak.spjall.socket.conversation
import samtak.spjall.socket.item
import samtak.spjall.socket.person

/** Photos and files, the disappearing timer and block (step 8 of the conversation UI). */
@OptIn(ExperimentalCoroutinesApi::class)
class ConversationMediaTest {
    @get:Rule val folder = TemporaryFolder()

    private val dispatcher = StandardTestDispatcher()
    private val account = FakeAccount(signedIn = true)
    private val live = FakeLive(account)

    @Before fun main() = Dispatchers.setMain(dispatcher)

    @After fun reset() = Dispatchers.resetMain()

    private fun TestScope.model(): ConversationViewModel {
        account.conversations = listOf(conversation("c1", person("a2", "Anna")))
        return ConversationViewModel("c1", account, live, dispatcher) {
            FakeAccount.NOW.toLong() + testScheduler.currentTime
        }.also { runCurrent() }
    }

    private val pdf = item(3u, content = Content.Media("application/pdf", 10uL, null, "skýrsla.pdf"))

    @Test
    fun aFileOverTheLimitIsRefusedBeforeItIsRead() =
        runTest(dispatcher) {
            val model = model()
            model.attach(Picked("image/jpeg", MEDIA_LIMIT + 1) { error("read") })
            advanceUntilIdle()
            assertEquals(Problem.TooLarge, model.state.value.problem)
            assertTrue(account.calls.none { it.startsWith("sendMedia") })
        }

    @Test
    fun aPickedFileIsSentUnderItsNameAndItsCopyDeleted() =
        runTest(dispatcher) {
            val model = model()
            val copy = folder.newFile().apply { writeText("hello") }
            model.attach(Picked("image/jpeg", 5, "fjall.jpg") { copy })
            advanceUntilIdle()
            assertTrue("sendMedia c1 image/jpeg fjall.jpg hello" in account.calls)
            assertFalse("the core keeps its own copy", copy.exists())
            assertNull(model.state.value.problem)
            assertEquals("the media message goes out", 1, live.syncs)
        }

    @Test
    fun aFailedDownloadCanBeAskedForAgainAndAReadyOneIsKept() =
        runTest(dispatcher) {
            val model = model()
            model.fetch(pdf)
            advanceUntilIdle()
            assertEquals(Media.Failed, model.state.value.media[3uL])
            account.files["c1" to 3uL] = "/store/media/3"
            model.fetch(pdf)
            advanceUntilIdle()
            assertEquals(Media.Ready("/store/media/3"), model.state.value.media[3uL])
            model.fetch(pdf)
            advanceUntilIdle()
            assertEquals(2, account.calls.count { it == "media c1 3" })
        }

    @Test
    fun openingAFileFetchesItAndHandsItOnWithItsName() =
        runTest(dispatcher) {
            val model = model()
            account.files["c1" to 3uL] = "/store/media/3"
            val opened = async { model.opened.first() }
            runCurrent()
            model.open(pdf)
            advanceUntilIdle()
            assertEquals(
                ConversationViewModel.Opened("/store/media/3", "application/pdf", "skýrsla.pdf"),
                opened.await(),
            )
        }

    @Test
    fun theTimerIsSetAndTurnedOff() =
        runTest(dispatcher) {
            val model = model()
            model.timer(3_600u)
            advanceUntilIdle()
            model.timer(null)
            advanceUntilIdle()
            assertEquals(
                listOf("send c1 Disappearing(seconds=3600)", "send c1 Disappearing(seconds=null)"),
                account.calls.filter { it.startsWith("send ") },
            )
        }

    @Test
    fun blockingEndsTheOneToOne() =
        runTest(dispatcher) {
            val model = model()
            model.block()
            advanceUntilIdle()
            assertTrue("block a2" in account.calls)
            assertEquals(listOf("a2"), account.blockedPeople.map { it.account })
        }

    @Test
    fun aFailedBlockIsSaidAndCanBeTriedAgain() =
        runTest(dispatcher) {
            val model = model()
            account.failNext = unreachable()
            model.block()
            advanceUntilIdle()
            assertEquals(Problem.Unreachable, model.state.value.problem)
            assertTrue(account.blockedPeople.isEmpty())
            model.retry()
            advanceUntilIdle()
            assertNull(model.state.value.problem)
            assertEquals(listOf("a2"), account.blockedPeople.map { it.account })
        }

    @Test
    fun aGroupHasNoOneToBlock() =
        runTest(dispatcher) {
            account.conversations = listOf(conversation("c1", person("a2", "Anna"), person("a3", "Bjarni")))
            val model = ConversationViewModel("c1", account, live, dispatcher) { 0L }
            advanceUntilIdle()
            model.block()
            assertTrue(account.calls.none { it.startsWith("block") })
        }
}
