package samtak.spjall.conversations

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
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
import samtak.spjall.core.MuteFor
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

            override fun mute(
                conversation: String,
                duration: MuteFor,
            ) {
                calls += "mute $conversation $duration"
            }

            override fun unmute(conversation: String) {
                calls += "unmute $conversation"
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
        compose.onNodeWithContentDescription(text(R.string.muted)).assertDoesNotExist()
        compose.onNodeWithText("Anna Jónsdóttir").performClick()
        assertEquals(listOf("open c1"), calls)
    }

    @Test
    fun aMutedRowSaysSoAndStillCountsTheUnread() {
        val muted = {
            id: String,
            mute: Mute,
            ->
            Conversation(id, ConversationState.ACTIVE, listOf(anna), null, 2u, null, mute)
        }
        show(
            ConversationsViewModel.State(
                conversations = listOf(muted("c1", Mute.Always), muted("c2", Mute.Until(1_700_003_600_000uL))),
                loaded = true,
                connection = Connection.Online,
            ),
        )
        // A mute silences, it does not hide (0042): the mark and the count are both there, in each row.
        compose.onAllNodesWithContentDescription(text(R.string.muted)).assertCountEquals(2)
        compose
            .onAllNodesWithContentDescription(context.resources.getQuantityString(R.plurals.unread_count, 2, 2))
            .assertCountEquals(2)
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
    fun anEmptyListAlsoFindsPeopleInThePicker() {
        show(ConversationsViewModel.State(loaded = true, connection = Connection.Online))
        // Everyone signed in is in the picker (0036), so the empty list leads there too (0043).
        compose.onNodeWithText(text(R.string.find_people)).assertIsDisplayed().performClick()
        assertEquals(listOf("newConversation"), calls)
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

    private fun own(
        status: ItemStatus,
        readBy: UInt = 0u,
    ) = Item(8uL, "e8", anna, true, 0uL, status, Content.Text("Takk", null), false, emptyList(), readBy, null, false)

    private fun row(
        last: Item?,
        members: List<Person> = listOf(anna),
        mute: Mute = Mute.Off,
    ) = Conversation("c1", ConversationState.ACTIVE, members, last, 0u, null, mute)

    @Test
    fun aLongPressOffersTheMuteAndItsDurations() {
        show(ConversationsViewModel.State(conversations = listOf(row(null)), loaded = true))
        compose.onNodeWithText("Anna Jónsdóttir").performTouchInput { longClick() }
        compose.onNodeWithText(text(R.string.mute)).performClick()
        compose.onNodeWithText(text(R.string.mute_hour)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.mute_eight_hours)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.mute_always)).performClick()
        assertEquals(listOf("mute c1 ALWAYS"), calls)
    }

    @Test
    fun aLongPressOnAMutedRowTurnsNotificationsBackOn() {
        show(ConversationsViewModel.State(conversations = listOf(row(null, mute = Mute.Always)), loaded = true))
        compose.onNodeWithText("Anna Jónsdóttir").performTouchInput { longClick() }
        compose.onNodeWithText(text(R.string.mute)).assertDoesNotExist()
        compose.onNodeWithText(text(R.string.unmute)).performClick()
        assertEquals(listOf("unmute c1"), calls)
    }

    @Test
    fun aRowWithSomeoneTypingSaysSoInPlaceOfThePreviewNamingNoOne() {
        val bjarni = Person("a3", "Bjarni Pálsson", false)
        val last = own(ItemStatus.SENT)
        show(
            ConversationsViewModel.State(
                conversations = listOf(row(last, members = listOf(anna, bjarni))),
                loaded = true,
                typing = setOf("c1"),
            ),
        )
        compose.onNodeWithText(text(R.string.typing_in_row)).assertIsDisplayed()
        compose.onNodeWithText(context.getString(R.string.last_line_own, "Takk")).assertDoesNotExist()
    }

    @Test
    fun theReadersOwnLastMessageCarriesItsState() {
        var last by mutableStateOf(own(ItemStatus.PENDING))
        var members by mutableStateOf(listOf(anna))
        compose.setContent {
            SpjallTheme {
                ConversationsScreen(
                    ConversationsViewModel.State(conversations = listOf(row(last, members)), loaded = true),
                    actions,
                )
            }
        }
        compose.onNodeWithContentDescription(text(R.string.message_sending)).assertIsDisplayed()

        last = own(ItemStatus.FAILED)
        compose.onNodeWithContentDescription(text(R.string.message_sending)).assertDoesNotExist()
        compose.onNodeWithText(text(R.string.message_failed)).assertIsDisplayed()

        // Read in a 1:1 says "Lesin" (0022).
        last = own(ItemStatus.SENT, readBy = 1u)
        compose.onNodeWithText(text(R.string.message_failed)).assertDoesNotExist()
        compose.onNodeWithText("· ${text(R.string.read_marker)}").assertIsDisplayed()

        // In a group, how many read it.
        members = listOf(anna, Person("a3", "Bjarni Pálsson", false))
        last = own(ItemStatus.SENT, readBy = 2u)
        compose
            .onNodeWithText("· ${context.resources.getQuantityString(R.plurals.read_by_count, 2, 2)}")
            .assertIsDisplayed()
    }
}
