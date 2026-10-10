package samtak.spjall.conversations

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import samtak.spjall.account.Problem
import samtak.spjall.brand.R
import samtak.spjall.core.Conversation
import samtak.spjall.core.ConversationState
import samtak.spjall.core.Mute
import samtak.spjall.core.Person
import samtak.spjall.ui.SpjallTheme

@RunWith(AndroidJUnit4::class)
class PickScreenTest {
    @get:Rule val compose = createComposeRule()

    private val calls = mutableListOf<String>()
    private val actions =
        object : PickActions {
            override fun toggle(conversation: String) {
                calls += "toggle $conversation"
            }

            override fun send() {
                calls += "send"
            }

            override fun back() {
                calls += "back"
            }

            override fun retry() {
                calls += "retry"
            }
        }

    private fun text(id: Int) = InstrumentationRegistry.getInstrumentation().targetContext.getString(id)

    private val conversations =
        listOf(
            Conversation("c2", ConversationState.ACTIVE, listOf(Person("a2", "Anna", true)), null, 0u, null, Mute.Off),
            Conversation(
                "c3",
                ConversationState.ACTIVE,
                listOf(Person("a3", "Björn", false), Person("a4", "Dóra", false)),
                null,
                0u,
                null,
                Mute.Off,
            ),
        )

    private fun show(state: PickViewModel.State) =
        compose.setContent { SpjallTheme { PickScreen(text(R.string.forward), state, actions) } }

    @Test
    fun eachConversationIsACheckboxAndNothingIsSentUntilOneIsPicked() {
        show(PickViewModel.State(conversations = conversations, loaded = true))
        compose.onNodeWithText(text(R.string.forward)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.send)).assertIsNotEnabled()
        compose.onNodeWithText("Anna").assertIsOff().performClick()
        compose.onNodeWithText("Björn", substring = true).assertIsDisplayed()
        assertEquals(listOf("toggle c2"), calls)
    }

    @Test
    fun thePickedOnesAreOnAndSendSendsThem() {
        show(PickViewModel.State(conversations = conversations, loaded = true, picked = setOf("c2")))
        compose.onNodeWithText("Anna").assertIsOn()
        compose.onNodeWithText(text(R.string.send)).assertIsEnabled().performClick()
        compose.onNodeWithContentDescription(text(R.string.back)).performClick()
        assertEquals(listOf("send", "back"), calls)
    }

    @Test
    fun nothingToSendIntoSaysSo() {
        show(PickViewModel.State(loaded = true))
        compose.onNodeWithText(text(R.string.pick_empty)).assertIsDisplayed()
    }

    @Test
    fun aProblemCanBeTriedAgain() {
        show(PickViewModel.State(conversations = conversations, loaded = true, problem = Problem.Unreachable))
        compose.onNodeWithText(text(R.string.try_again)).performClick()
        assertEquals(listOf("retry"), calls)
    }
}
