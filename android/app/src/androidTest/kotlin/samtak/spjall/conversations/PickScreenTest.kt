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
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import samtak.spjall.account.Problem
import samtak.spjall.brand.R
import samtak.spjall.core.Content
import samtak.spjall.core.Conversation
import samtak.spjall.core.ConversationState
import samtak.spjall.core.Item
import samtak.spjall.core.ItemStatus
import samtak.spjall.core.Mute
import samtak.spjall.core.Person
import samtak.spjall.core.Post
import samtak.spjall.core.ReactionCounts
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

            override fun search(text: String) {
                calls += "search $text"
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

    @Test
    fun typingInTheFieldSearches() {
        show(PickViewModel.State(conversations = conversations, loaded = true))
        compose.onNodeWithText(text(R.string.pick_search)).performTextInput("Bj")
        assertEquals(listOf("search Bj"), calls)
    }

    @Test
    fun theRowsAreWhatTheSearchFound() {
        show(
            PickViewModel.State(
                conversations = conversations,
                loaded = true,
                query = "Bj",
                found = conversations.drop(1),
            ),
        )
        compose.onNodeWithText("Anna").assertDoesNotExist()
        compose.onNodeWithText("Björn", substring = true).assertIsDisplayed()
    }

    @Test
    fun aSearchThatFindsNothingSaysSo() {
        show(PickViewModel.State(conversations = conversations, loaded = true, query = "zz", found = emptyList()))
        compose.onNodeWithText(text(R.string.pick_none_found)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.pick_empty)).assertDoesNotExist()
    }

    @Test
    fun theMessageBeingForwardedShowsAtTheTop() {
        val item =
            Item(
                7uL,
                "e7",
                Person("a2", "Anna", true),
                false,
                0uL,
                ItemStatus.SENT,
                Content.Text("Sjáumst á morgun", null),
                false,
                emptyList(),
                0u,
                null,
                false,
            )
        show(PickViewModel.State(conversations = conversations, loaded = true, outgoing = Outgoing.Message(item)))
        compose.onNodeWithText("Sjáumst á morgun").assertIsDisplayed()
    }

    @Test
    fun thePostBeingSharedShowsWithItsAuthor() {
        val post =
            Post("p1", Person("a6", "Elín", false), "Fundur í kvöld", 0uL, 0u, ReactionCounts(0u, 0u, 0u, 0u, 0u), null)
        show(PickViewModel.State(conversations = conversations, loaded = true, outgoing = Outgoing.SharedPost(post)))
        compose.onNodeWithText("Elín", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Fundur í kvöld").assertIsDisplayed()
    }
}
