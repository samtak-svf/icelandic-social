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
import org.junit.Before
import org.junit.Test
import samtak.spjall.account.FakeAccount
import samtak.spjall.socket.FakeLive
import samtak.spjall.socket.conversation
import samtak.spjall.socket.item
import samtak.spjall.socket.person

/** #324: the screen's view model goes when the conversation is left; its unsent text does not. */
@OptIn(ExperimentalCoroutinesApi::class)
class ConversationDraftsTest {
    private val dispatcher = StandardTestDispatcher()
    private val account = FakeAccount(signedIn = true)
    private val live = FakeLive(account)
    private val drafts = Drafts()

    @Before fun main() = Dispatchers.setMain(dispatcher)

    @After fun reset() = Dispatchers.resetMain()

    private fun TestScope.model(id: String = "c1"): ConversationViewModel {
        account.conversations = listOf(conversation("c1", person("a2", "Anna")), conversation("c2"))
        return ConversationViewModel(id, account, live, drafts, dispatcher, { _, _ -> }) {
            FakeAccount.NOW.toLong() + testScheduler.currentTime
        }.also { runCurrent() }
    }

    @Test
    fun anUnsentDraftIsThereAgainWhenTheConversationIsOpenedAgain() =
        runTest(dispatcher) {
            model().draft("hálfskrifað")

            val again = model()
            assertEquals("hálfskrifað", again.state.value.draft)
            assertEquals(ConversationViewModel.ComposerAction.SEND, again.state.value.action)
            assertEquals("each conversation keeps its own", "", model("c2").state.value.draft)

            again.send()
            runCurrent()
            assertEquals("a sent draft is gone", "", model().state.value.draft)
        }

    @Test
    fun anEditLeavesTheUnsentDraftAsItWas() =
        runTest(dispatcher) {
            val target = item(4u, own = true, text = "gamalt")
            val model = model()
            model.draft("óklárað")

            model.edit(target)
            model.draft("nýtt")
            assertEquals("the edit's text is not kept", "óklárað", drafts["c1"])
            model.cancelMode()
            assertEquals("óklárað", model.state.value.draft)

            model.edit(target)
            model.draft("nýtt")
            model.send()
            runCurrent()
            assertEquals("óklárað", model.state.value.draft)
            assertEquals("óklárað", model().state.value.draft)
        }
}
