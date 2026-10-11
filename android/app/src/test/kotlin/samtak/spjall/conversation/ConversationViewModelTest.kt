package samtak.spjall.conversation

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
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
import org.junit.Test
import samtak.spjall.account.FakeAccount
import samtak.spjall.account.Problem
import samtak.spjall.account.unreachable
import samtak.spjall.core.Body
import samtak.spjall.core.Event
import samtak.spjall.core.Mute
import samtak.spjall.core.MuteFor
import samtak.spjall.core.Outcome
import samtak.spjall.core.Reaction
import samtak.spjall.socket.FakeLive
import samtak.spjall.socket.conversation
import samtak.spjall.socket.item
import samtak.spjall.socket.person

@OptIn(ExperimentalCoroutinesApi::class)
class ConversationViewModelTest {
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

    private fun sends() = account.calls.filter { it.startsWith("send ") }

    @Test
    fun readsTheNewestPageAndMarksItRead() =
        runTest(dispatcher) {
            account.timelines["c1"] = mutableListOf(item(1u), item(2u))
            val model = model()
            val state = model.state.value
            assertEquals("c1", state.conversation?.id)
            assertEquals(listOf(1uL, 2uL), state.items.map { it.seq })
            assertTrue(state.loaded)
            assertFalse("a short page is the whole timeline", state.older)
            assertTrue("markRead c1 2" in account.calls)
            assertEquals(1, live.syncs)
        }

    @Test
    fun marksReadOnlyWhenTheNewestAdvanced() =
        runTest(dispatcher) {
            account.timelines["c1"] = mutableListOf(item(1u))
            val model = model()
            model.load()
            runCurrent()
            assertEquals(1, account.calls.count { it.startsWith("markRead") })
            account.timelines.getValue("c1") += item(2u)
            live.events.emit(Event.Timeline("c1", listOf(2uL)))
            runCurrent()
            assertEquals(listOf("markRead c1 1", "markRead c1 2"), account.calls.filter { it.startsWith("markRead") })
        }

    @Test
    fun readsAgainOnlyForEventsOfThisConversation() =
        runTest(dispatcher) {
            model()
            val reads = { account.calls.count { it == "timeline c1 -" } }
            assertEquals(1, reads())
            live.events.emit(Event.Timeline("c2", listOf(1uL)))
            runCurrent()
            assertEquals(1, reads())
            live.events.emit(Event.Expired("c1", listOf(1uL)))
            runCurrent()
            assertEquals(2, reads())
        }

    @Test
    fun sendsTextRepliesAndEdits() =
        runTest(dispatcher) {
            val target = item(4u, own = true)
            account.timelines["c1"] = mutableListOf(target)
            val model = model()

            model.draft("  Halló  ")
            model.send()
            runCurrent()
            model.reply(target)
            model.draft("Já")
            model.send()
            runCurrent()
            model.edit(target)
            assertEquals("m4", model.state.value.draft)
            model.draft("m4!")
            model.send()
            runCurrent()

            assertEquals(
                listOf(
                    "send c1 ${Body.Text("Halló")}",
                    "send c1 ${Body.Reply("e4", "Já")}",
                    "send c1 ${Body.Edit("e4", "m4!")}",
                ),
                sends(),
            )
            val state = model.state.value
            assertEquals("", state.draft)
            assertEquals(ConversationViewModel.Mode.New, state.mode)
            assertTrue("the pending item shows", state.items.any { it.seq == null })
        }

    @Test
    fun theComposerAttachesWhileEmptyAndSendsOnceThereIsText() =
        runTest(dispatcher) {
            val target = item(4u, own = true)
            val model = model()
            val action = { model.state.value.action }
            assertEquals(ConversationViewModel.ComposerAction.ATTACH, action())
            model.draft("  ")
            assertEquals(ConversationViewModel.ComposerAction.ATTACH, action())
            model.draft("Hæ")
            assertEquals(ConversationViewModel.ComposerAction.SEND, action())
            model.draft("")
            model.reply(target)
            assertEquals("a reply never attaches", ConversationViewModel.ComposerAction.SEND, action())
            model.cancelMode()
            model.edit(target)
            model.draft("")
            assertEquals("send stays while editing", ConversationViewModel.ComposerAction.SEND, action())
        }

    @Test
    fun aBlankDraftSendsNothingAndCancellingAnEditClearsIt() =
        runTest(dispatcher) {
            val target = item(4u, own = true)
            val model = model()
            model.draft("   ")
            model.send()
            runCurrent()
            assertTrue(sends().isEmpty())

            model.edit(target)
            model.cancelMode()
            assertEquals("", model.state.value.draft)
            model.reply(target)
            model.draft("svar")
            model.cancelMode()
            assertEquals("svar", model.state.value.draft)
        }

    @Test
    fun deletesAndTogglesReactions() =
        runTest(dispatcher) {
            val model = model()
            val mine = Reaction("👍", true, listOf(person("a1", "Jón")))
            val theirs = Reaction("❤️", false, listOf(person("a2", "Anna")))
            val target = item(4u, reactions = listOf(mine, theirs))
            model.delete(target)
            model.react(target, "👍")
            model.react(target, "❤️")
            runCurrent()
            assertEquals(
                listOf(
                    "send c1 ${Body.Delete("e4")}",
                    "send c1 ${Body.Reaction("e4", "👍", true)}",
                    "send c1 ${Body.Reaction("e4", "❤️", false)}",
                ),
                sends(),
            )
        }

    @Test
    fun aFailedSendIsAProblemThatRetrySendsAgain() =
        runTest(dispatcher) {
            val model = model()
            model.draft("Halló")
            model.paused()
            runCurrent()
            // The typing frames are done, so the send is what fails.
            account.failNext = unreachable()
            model.send()
            runCurrent()
            assertEquals(Problem.Unreachable, model.state.value.problem)
            assertTrue("nothing was queued", account.timelines["c1"].isNullOrEmpty())

            model.retry()
            runCurrent()
            assertNull(model.state.value.problem)
            assertEquals(List(2) { "send c1 ${Body.Text("Halló")}" }, sends())
            assertEquals(1, account.timelines.getValue("c1").size)
        }

    @Test
    fun mutesForEachDurationAndTurnsNotificationsBackOn() =
        runTest(dispatcher) {
            val model = model()
            model.mute(MuteFor.EIGHT_HOURS)
            advanceUntilIdle()
            assertEquals(
                Mute.Until(FakeAccount.NOW + 8uL * 3_600_000uL),
                model.state.value.conversation
                    ?.mute,
            )

            model.mute(MuteFor.ALWAYS)
            advanceUntilIdle()
            assertEquals(
                Mute.Always,
                model.state.value.conversation
                    ?.mute,
            )

            model.unmute()
            advanceUntilIdle()
            assertEquals(
                Mute.Off,
                model.state.value.conversation
                    ?.mute,
            )
            val asked = account.calls.filter { it.startsWith("mute") || it.startsWith("unmute") }
            assertEquals(listOf("mute c1 EIGHT_HOURS", "mute c1 ALWAYS", "unmute c1"), asked)
        }

    @Test
    fun aFailedMuteIsAProblemThatRetryMutesAgain() =
        runTest(dispatcher) {
            val model = model()
            account.failNext = unreachable()
            model.mute(MuteFor.HOUR)
            advanceUntilIdle()
            // Said, not swallowed: the person must not believe a mute that did not happen.
            assertEquals(Problem.Unreachable, model.state.value.problem)
            assertEquals(
                Mute.Off,
                model.state.value.conversation
                    ?.mute,
            )

            model.retry()
            advanceUntilIdle()
            assertNull(model.state.value.problem)
            assertEquals(
                Mute.Until(FakeAccount.NOW + 3_600_000uL),
                model.state.value.conversation
                    ?.mute,
            )
        }

    @Test
    fun resendAsksTheCoreToRetryTheOutbox() =
        runTest(dispatcher) {
            model().resend()
            assertTrue("retry c1" in account.calls)
        }

    @Test
    fun typingSendsAFrameAndStopsWhenIdle() =
        runTest(dispatcher) {
            val model = model()
            model.draft("H")
            runCurrent()
            assertEquals(listOf("""{"type":"typing","active":true}"""), live.sent)
            advanceTimeBy(5_001)
            runCurrent()
            assertEquals("""{"type":"typing","active":false}""", live.sent.last())
            assertEquals(2, live.sent.size)
        }

    @Test
    fun aKeyWhileTheFrameIsMadeDoesNotLoseIt() =
        runTest(dispatcher) {
            val model = model()
            // The next key comes while the core makes the first frame, as on a fast keyboard.
            account.onTyping = {
                account.onTyping = null
                model.draft("Ha")
            }
            model.draft("H")
            runCurrent()
            assertEquals(listOf("""{"type":"typing","active":true}"""), live.sent)
        }

    @Test
    fun sendingAndPausingStopTyping() =
        runTest(dispatcher) {
            val model = model()
            model.draft("H")
            runCurrent()
            model.paused()
            runCurrent()
            assertEquals("""{"type":"typing","active":false}""", live.sent.last())
            model.paused()
            runCurrent()
            assertEquals("a second pause sends nothing", 2, live.sent.size)
        }

    @Test
    fun typingOffInSettingsSendsNoFrame() =
        runTest(dispatcher) {
            account.typingOn = false
            val model = model()
            model.draft("H")
            model.paused()
            advanceUntilIdle()
            assertTrue(live.sent.isEmpty())
        }

    @Test
    fun theOtherSideTypingShowsAndFades() =
        runTest(dispatcher) {
            val model = model()
            live.events.emit(Event.Typing("c2", true))
            runCurrent()
            assertFalse(model.state.value.typing)
            live.events.emit(Event.Typing("c1", true))
            runCurrent()
            assertTrue(model.state.value.typing)
            advanceTimeBy(6_001)
            runCurrent()
            assertFalse(model.state.value.typing)
        }

    @Test
    fun expiresWhenTheFirstItemIsDue() =
        runTest(dispatcher) {
            account.timelines["c1"] = mutableListOf(item(1u, expiresAt = FakeAccount.NOW + 2_000uL))
            account.outcomes += Outcome(listOf(Event.Expired("c1", listOf(1uL))), emptyList())
            model()
            assertFalse("expire" in account.calls)
            account.timelines.getValue("c1").clear()
            advanceTimeBy(2_001)
            runCurrent()
            assertTrue("expire" in account.calls)
            assertEquals(2, account.calls.count { it == "timeline c1 -" })
        }

    @Test
    fun loadsOlderPagesUntilTheStart() =
        runTest(dispatcher) {
            account.timelines["c1"] = (1uL..120uL).map { item(it) }.toMutableList()
            val model = model()
            assertEquals(
                71uL,
                model.state.value.items
                    .first()
                    .seq,
            )
            assertTrue(model.state.value.older)
            model.loadOlder()
            runCurrent()
            assertEquals(
                21uL,
                model.state.value.items
                    .first()
                    .seq,
            )
            model.loadOlder()
            runCurrent()
            assertEquals(
                1uL,
                model.state.value.items
                    .first()
                    .seq,
            )
            assertFalse(model.state.value.older)
            model.loadOlder()
            runCurrent()
            assertEquals(
                "a short page ends the paging",
                2,
                account.calls.count {
                    it.startsWith("timeline c1 ") &&
                        !it.endsWith("-")
                },
            )
        }
}
