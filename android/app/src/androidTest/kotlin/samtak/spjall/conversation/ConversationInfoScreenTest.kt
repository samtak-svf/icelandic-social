package samtak.spjall.conversation

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onLast
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextReplacement
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import samtak.spjall.brand.R
import samtak.spjall.core.Conversation
import samtak.spjall.core.ConversationState
import samtak.spjall.core.Item
import samtak.spjall.core.Mute
import samtak.spjall.core.MuteFor
import samtak.spjall.core.Person
import samtak.spjall.ui.SpjallTheme

/**
 * Naming a group (0078), on a device: the dialog holds a text field, and Robolectric never reports a
 * screen with one inside a dialog window as idle, so the rest of the screen's tests are
 * [ConversationInfoScreenshotTest].
 */
@RunWith(AndroidJUnit4::class)
class ConversationInfoScreenTest {
    @get:Rule val compose = createComposeRule()

    private val calls = mutableListOf<String>()

    private val actions =
        object : ConversationInfoActions {
            override fun back() = Unit

            override fun timer(seconds: UInt?) {
                calls += "timer $seconds"
            }

            override fun mute(duration: MuteFor) {
                calls += "mute $duration"
            }

            override fun unmute() {
                calls += "unmute"
            }

            override fun block() {
                calls += "block"
            }

            override fun add() {
                calls += "add"
            }

            override fun rename(name: String?) {
                calls += "rename $name"
            }

            override fun remove(account: String) {
                calls += "remove $account"
            }

            override fun leave() {
                calls += "leave"
            }

            override fun fetch(item: Item) = Unit

            override fun open(item: Item) = Unit

            override fun more() = Unit

            override fun retry() = Unit
        }

    private fun text(id: Int) = InstrumentationRegistry.getInstrumentation().targetContext.getString(id)

    private val anna = Person("a2", "Anna Jónsdóttir", true)
    private val bjorn = Person("a3", "Björn Sigurðsson", false)

    private fun show(
        name: String? = null,
        members: List<Person> = listOf(anna, bjorn),
        timer: UInt? = null,
        mute: Mute = Mute.Off,
    ) {
        compose.setContent {
            SpjallTheme {
                ConversationInfoScreen(
                    ConversationViewModel.State(
                        conversation =
                            Conversation(
                                id = "c1",
                                state = ConversationState.ACTIVE,
                                name = name,
                                members = members,
                                last = null,
                                unread = 0u,
                                timer = timer,
                                mute = mute,
                            ),
                        loaded = true,
                    ),
                    actions,
                )
            }
        }
    }

    @Test
    fun aNameIsTypedAndSavedWithoutItsSpaces() {
        show()
        compose.onNodeWithText(text(R.string.group_name)).performClick()
        compose.onNodeWithText(text(R.string.group_name_title)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.group_name_hint)).assertIsDisplayed()
        compose.onNode(hasSetTextAction()).performTextReplacement("  Fjölskyldan  ")
        compose.onNodeWithText(text(R.string.save)).performClick()
        assertEquals(listOf("rename Fjölskyldan"), calls)
    }

    @Test
    fun aNameOfOnlySpacesClearsIt() {
        show(name = "Fjölskyldan")
        compose.onNodeWithText(text(R.string.group_name)).performClick()
        compose.onNode(hasSetTextAction()).performTextReplacement("   ")
        compose.onNodeWithText(text(R.string.save)).performClick()
        assertEquals(listOf("rename null"), calls)
    }

    @Test
    fun theNameItHasIsInTheFieldAndCanBeTakenAway() {
        show(name = "Fjölskyldan")
        compose.onNodeWithText(text(R.string.group_name)).performClick()
        compose.onNode(hasSetTextAction()).assertTextContains("Fjölskyldan")
        compose.onNodeWithText(text(R.string.group_name_remove)).performClick()
        assertEquals(listOf("rename null"), calls)
    }

    /** With no name there is nothing to take away, so the dialog offers only the way out (0078). */
    @Test
    fun anUnnamedGroupOffersNoRemove() {
        show()
        compose.onNodeWithText(text(R.string.group_name)).performClick()
        compose.onNodeWithText(text(R.string.group_name_remove)).assertDoesNotExist()
        compose.onNodeWithText(text(R.string.cancel)).performClick()
        assertEquals(emptyList<String>(), calls)
    }

    @Test
    fun cancellingChangesNothing() {
        show(name = "Fjölskyldan")
        compose.onNodeWithText(text(R.string.group_name)).performClick()
        compose.onNode(hasSetTextAction()).performTextReplacement("Annað")
        compose.onNodeWithText(text(R.string.cancel)).performClick()
        assertEquals(emptyList<String>(), calls)
    }

    private fun dialogOption(label: String) = compose.onAllNodesWithText(label).onLast()

    @Test
    fun theTimerRowPicksTheTimerAndTheOneAlreadySetChangesNothing() {
        show(members = listOf(anna), timer = 3_600u)
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val hour = context.resources.getQuantityString(R.plurals.duration_hours, 1, 1)
        compose.onNodeWithText(text(R.string.disappearing_messages)).performClick()
        dialogOption(context.getString(R.string.disappearing_option, hour)).performClick()
        assertEquals(emptyList<String>(), calls)
        compose.onNodeWithText(text(R.string.disappearing_messages)).performClick()
        dialogOption(text(R.string.disappearing_off)).performClick()
        assertEquals(listOf("timer null"), calls)
    }

    @Test
    fun blockAsksFirstAndIsOnlyOfferedInAOneToOne() {
        show(members = listOf(anna))
        compose.onNodeWithText(text(R.string.block)).performClick()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        compose.onNodeWithText(context.getString(R.string.block_confirm, "Anna Jónsdóttir")).assertIsDisplayed()
        assertEquals(emptyList<String>(), calls)
        dialogOption(text(R.string.block)).performClick()
        assertEquals(listOf("block"), calls)
    }

    @Test
    fun theMuteRowMutesForEachDuration() {
        show(members = listOf(anna))
        compose.onNodeWithText(text(R.string.unmute)).assertDoesNotExist()
        listOf(R.string.mute_hour, R.string.mute_eight_hours, R.string.mute_always).forEach { duration ->
            compose.onNodeWithText(text(R.string.mute)).performClick()
            compose.onNodeWithText(text(duration)).performClick()
        }
        assertEquals(listOf("mute HOUR", "mute EIGHT_HOURS", "mute ALWAYS"), calls)
    }

    @Test
    fun aMutedConversationOffersNotificationsBackInstead() {
        show(members = listOf(anna), mute = Mute.Until(1_700_003_600_000uL))
        compose.onNodeWithText(text(R.string.mute)).assertDoesNotExist()
        compose.onNodeWithText(text(R.string.unmute)).performClick()
        assertEquals(listOf("unmute"), calls)
    }

    @Test
    fun aGroupHasNoBlockRow() {
        show(members = listOf(anna, bjorn))
        compose.onNodeWithText(text(R.string.disappearing_messages)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.block)).assertDoesNotExist()
    }
}
