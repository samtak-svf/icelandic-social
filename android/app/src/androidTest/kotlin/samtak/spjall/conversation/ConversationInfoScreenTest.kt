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

            override fun timer(seconds: UInt?) = Unit

            override fun mute(duration: MuteFor) = Unit

            override fun unmute() = Unit

            override fun block() = Unit

            override fun add() {
                calls += "add"
            }

            override fun rename(name: String?) {
                calls += "rename $name"
            }

            override fun setPhoto() {
                calls += "setPhoto"
            }

            override fun clearPhoto() {
                calls += "clearPhoto"
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
        photo: String? = null,
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
                                photo = photo,
                                members = members,
                                last = null,
                                unread = 0u,
                                timer = null,
                                mute = Mute.Off,
                            ),
                        loaded = true,
                    ),
                    actions,
                )
            }
        }
    }

    @Test
    fun aGroupWithoutAPhotoChoosesOne() {
        show()
        compose.onNodeWithText(text(R.string.group_photo_choose)).performClick()
        assertEquals(listOf("setPhoto"), calls)
    }

    @Test
    fun aGroupWithAPhotoChangesItAndRemovesItAfterAsking() {
        show(photo = "/data/group.jpg")
        compose.onNodeWithText(text(R.string.group_photo_change)).performClick()
        compose.onNodeWithText(text(R.string.group_photo_remove)).performClick()
        compose.onNodeWithText(text(R.string.group_photo_remove_confirm)).assertIsDisplayed()
        assertEquals(listOf("setPhoto"), calls)
        compose.onAllNodesWithText(text(R.string.group_photo_remove)).onLast().performClick()
        assertEquals(listOf("setPhoto", "clearPhoto"), calls)
    }

    @Test
    fun aOneToOneShowsNoPhotoControl() {
        show(members = listOf(anna))
        compose.onNodeWithText(text(R.string.group_photo_choose)).assertDoesNotExist()
        compose.onNodeWithText(text(R.string.group_photo_change)).assertDoesNotExist()
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
}
