package samtak.spjall.conversations

import androidx.compose.ui.test.assertIsDisplayed
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
import samtak.spjall.brand.R
import samtak.spjall.core.Content
import samtak.spjall.core.Conversation
import samtak.spjall.core.ConversationState
import samtak.spjall.core.Item
import samtak.spjall.core.ItemStatus
import samtak.spjall.core.Person
import samtak.spjall.socket.Connection
import samtak.spjall.ui.Dates
import samtak.spjall.ui.SpjallTheme

@RunWith(AndroidJUnit4::class)
class ConversationsScreenTest {
    @get:Rule val compose = createComposeRule()

    private val calls = mutableListOf<String>()
    private val actions =
        object : ConversationsActions {
            override fun open(conversation: String) {
                calls += "open $conversation"
            }

            override fun newConversation() {
                calls += "newConversation"
            }

            override fun invite() {
                calls += "invite"
            }

            override fun retry() {
                calls += "retry"
            }
        }

    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    private fun text(id: Int) = context.getString(id)

    private val anna = Person("a2", "Anna Jónsdóttir", true)

    private fun show(state: ConversationsViewModel.State) =
        compose.setContent { SpjallTheme { ConversationsScreen(state, actions) } }

    @Test
    fun aRowShowsItsLastLineAndUnreadCountAndOpensOnTap() {
        val last =
            Item(
                5uL,
                "e5",
                anna,
                false,
                1_700_000_000_000uL,
                ItemStatus.SENT,
                Content.Text("Sæl", null),
                false,
                emptyList(),
                0u,
                null,
            )
        show(
            ConversationsViewModel.State(
                conversations = listOf(Conversation("c1", ConversationState.ACTIVE, listOf(anna), last, 3u, null)),
                loaded = true,
                connection = Connection.Online,
            ),
        )
        compose.onNodeWithText("Sæl").assertIsDisplayed()
        compose
            .onNodeWithContentDescription(context.resources.getQuantityString(R.plurals.unread_count, 3, 3))
            .assertIsDisplayed()
        compose.onNodeWithContentDescription(text(R.string.verified_with_kennitala)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.connection_offline)).assertDoesNotExist()
        compose.onNodeWithText("Anna Jónsdóttir").performClick()
        assertEquals(listOf("open c1"), calls)
    }

    @Test
    fun anEmptyListPointsAtTheInviteAndSaysWhenOffline() {
        show(ConversationsViewModel.State(loaded = true, connection = Connection.Offline))
        compose.onNodeWithText(text(R.string.conversations_empty)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.connection_offline)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.invite)).performClick()
        compose.onNodeWithContentDescription(text(R.string.new_conversation)).performClick()
        assertEquals(listOf("invite", "newConversation"), calls)
    }

    @Test
    fun theReadersOwnLastMessageStartsWithYou() {
        val now = System.currentTimeMillis().toULong()
        val last =
            Item(6uL, "e6", anna, true, now, ItemStatus.SENT, Content.Text("Takk", null), false, emptyList(), 0u, null)
        show(
            ConversationsViewModel.State(
                conversations = listOf(Conversation("c1", ConversationState.ACTIVE, listOf(anna), last, 0u, null)),
                loaded = true,
            ),
        )
        compose.onNodeWithText(context.getString(R.string.last_line_own, "Takk")).assertIsDisplayed()
        // A message from today shows its time on a 24-hour clock, whatever the device's language.
        compose.onNodeWithText(Dates.time(Dates.at(now))).assertIsDisplayed()
    }

    @Test
    fun nothingIsSaidAboutAnEmptyListBeforeItIsRead() {
        show(ConversationsViewModel.State())
        compose.onNodeWithText(text(R.string.conversations_empty)).assertDoesNotExist()
    }

    @Test
    fun aDeadInviteLinkIsSaid() {
        show(ConversationsViewModel.State(loaded = true, inviteExpired = true))
        compose.onNodeWithText(text(R.string.link_expired)).assertIsDisplayed()
    }
}
