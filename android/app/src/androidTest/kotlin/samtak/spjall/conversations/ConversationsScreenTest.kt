package samtak.spjall.conversations

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
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
import samtak.spjall.brand.R
import samtak.spjall.core.Content
import samtak.spjall.core.Conversation
import samtak.spjall.core.ConversationState
import samtak.spjall.core.Item
import samtak.spjall.core.ItemStatus
import samtak.spjall.core.Mute
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

            override fun search(text: String) {
                calls += "search $text"
            }

            override fun openPerson(account: String) {
                calls += "openPerson $account"
            }

            override fun invite() {
                calls += "invite"
            }

            override fun retry() {
                calls += "retry"
            }

            override fun notificationSettings() {
                calls += "notificationSettings"
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
                false,
            )
        show(
            ConversationsViewModel.State(
                conversations =
                    listOf(
                        Conversation("c1", ConversationState.ACTIVE, listOf(anna), last, 3u, null, Mute.Off),
                    ),
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
    fun aSharedPostIsListedInFixedWordsAsSaidByItsSender() {
        val last =
            Item(6uL, "e6", anna, true, 0uL, ItemStatus.SENT, Content.Post("p1"), false, emptyList(), 0u, null, false)
        show(
            ConversationsViewModel.State(
                conversations =
                    listOf(
                        Conversation("c1", ConversationState.ACTIVE, listOf(anna), last, 0u, null, Mute.Off),
                    ),
                loaded = true,
            ),
        )
        compose
            .onNodeWithText(context.getString(R.string.last_line_own, context.getString(R.string.post_shared)))
            .assertIsDisplayed()
    }

    @Test
    fun theReadersOwnLastMessageStartsWithYou() {
        val now = System.currentTimeMillis().toULong()
        val last =
            Item(
                6uL,
                "e6",
                anna,
                true,
                now,
                ItemStatus.SENT,
                Content.Text("Takk", null),
                false,
                emptyList(),
                0u,
                null,
                false,
            )
        show(
            ConversationsViewModel.State(
                conversations =
                    listOf(
                        Conversation("c1", ConversationState.ACTIVE, listOf(anna), last, 0u, null, Mute.Off),
                    ),
                loaded = true,
            ),
        )
        compose.onNodeWithText(context.getString(R.string.last_line_own, "Takk")).assertIsDisplayed()
        // A message from today shows its time on a 24-hour clock, whatever the device's language.
        compose.onNodeWithText(Dates.time(Dates.at(now))).assertIsDisplayed()
    }

    @Test
    fun aGroupsLastMessageStartsWithTheSendersFirstName() {
        val bjarni = Person("a3", "Bjarni Pálsson", false)
        val last =
            Item(
                7uL,
                "e7",
                anna,
                false,
                0uL,
                ItemStatus.SENT,
                Content.Text("Sæl", null),
                false,
                emptyList(),
                0u,
                null,
                false,
            )
        show(
            ConversationsViewModel.State(
                conversations =
                    listOf(
                        Conversation("c1", ConversationState.ACTIVE, listOf(anna, bjarni), last, 0u, null, Mute.Off),
                    ),
                loaded = true,
            ),
        )
        compose.onNodeWithText(context.getString(R.string.last_line_sender, "Anna", "Sæl")).assertIsDisplayed()
    }

    @Test
    fun theListSaysWhenNotificationsAreOffAndLeadsToTheirSettings() {
        val state = ConversationsViewModel.State(loaded = true)
        var off by mutableStateOf(true)
        compose.setContent { SpjallTheme { ConversationsScreen(state, actions, notificationsOff = off) } }
        compose.onNodeWithText(text(R.string.notifications_off)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.notifications_settings)).performClick()
        assertEquals(listOf("notificationSettings"), calls)
        off = false
        compose.onNodeWithText(text(R.string.notifications_off)).assertDoesNotExist()
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

    @Test
    fun typingInTheSearchFieldSearches() {
        show(ConversationsViewModel.State(loaded = true))
        compose.onNodeWithText(text(R.string.conversations_search)).performTextInput("Þór")
        assertEquals(listOf("search Þór"), calls)
    }

    @Test
    fun aSearchShowsTheConversationsFoundThenPeopleUnderTheirHeading() {
        val thordis = Person("a4", "Þórdís Ýr", false)
        show(
            ConversationsViewModel.State(
                conversations =
                    listOf(
                        Conversation("c9", ConversationState.ACTIVE, listOf(anna), null, 0u, null, Mute.Off),
                    ),
                loaded = true,
                query = "Þór",
                found =
                    ConversationsViewModel.Found(
                        "Þór",
                        listOf(Conversation("c1", ConversationState.ACTIVE, listOf(thordis), null, 0u, null, Mute.Off)),
                        listOf(thordis, Person("a5", "Þórunn Halla", true)),
                    ),
            ),
        )
        // The list itself gives way to what was found.
        compose.onNodeWithText("Anna Jónsdóttir").assertDoesNotExist()
        compose.onNodeWithText(text(R.string.conversations_people)).assertIsDisplayed()
        val rows = compose.onAllNodesWithText("Þórdís Ýr")
        rows[0].performClick()
        rows[1].performClick()
        compose.onNodeWithText("Þórunn Halla").performClick()
        assertEquals(listOf("open c1", "openPerson a4", "openPerson a5"), calls)
    }

    @Test
    fun aSearchThatFindsNothingSaysSo() {
        show(
            ConversationsViewModel.State(
                loaded = true,
                query = "Zz",
                found = ConversationsViewModel.Found("Zz", emptyList(), emptyList()),
            ),
        )
        compose.onNodeWithText(text(R.string.conversations_none_found)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.conversations_empty)).assertDoesNotExist()
        compose.onNodeWithText(text(R.string.conversations_people)).assertDoesNotExist()
    }
}
