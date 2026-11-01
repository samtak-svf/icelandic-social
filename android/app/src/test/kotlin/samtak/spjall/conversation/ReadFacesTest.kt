package samtak.spjall.conversation

import android.content.Context
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import samtak.spjall.brand.R
import samtak.spjall.conversations.SCREENSHOT_DEVICE
import samtak.spjall.conversations.SCREENSHOT_SDK
import samtak.spjall.core.Conversation
import samtak.spjall.core.ConversationState
import samtak.spjall.core.Item
import samtak.spjall.core.Mute
import samtak.spjall.core.Person
import samtak.spjall.socket.item
import samtak.spjall.socket.person
import samtak.spjall.ui.IcelandZone
import samtak.spjall.ui.SpjallTheme

/** Faces under a message show who has read it in a group, the word stays in a 1:1 (0125). */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [SCREENSHOT_SDK], qualifiers = SCREENSHOT_DEVICE, fontScale = 1f)
class ReadFacesTest {
    @get:Rule val compose = createComposeRule()

    @get:Rule val zone = IcelandZone()

    private val anna = person("a2", "Anna")
    private val bjorn = person("a3", "Björn")
    private val crowd = (1..6).map { person("p$it", "Gestur $it") }

    private val context get() = ApplicationProvider.getApplicationContext<Context>()

    private fun text(id: Int) = context.getString(id)

    private fun show(
        members: List<Person>,
        vararg items: Item,
    ) = compose.setContent {
        SpjallTheme {
            ConversationScreen(
                ConversationViewModel.State(
                    conversation =
                        Conversation("c1", ConversationState.ACTIVE, null, null, members, null, 0u, null, Mute.Off),
                    items = items.toList(),
                    loaded = true,
                ),
                IdleActions,
            )
        }
    }

    private fun spoken(people: List<Person>) =
        context.getString(R.string.read_by_faces, people.joinToString(", ") { it.name!! })

    @Test
    fun noFacesWhenNobodyHasReadHere() {
        show(listOf(anna, bjorn), item(1u))
        compose.onAllNodesWithContentDescription(spoken(listOf(anna)), substring = true).assertCountEquals(0)
        compose.onAllNodesWithText("+", substring = true, useUnmergedTree = true).assertCountEquals(0)
    }

    @Test
    fun fewFacesShowNoMoreMarkAndSpeakEveryName() {
        val readers = crowd.take(3)
        show(listOf(anna, bjorn), item(1u, readHere = readers))
        compose.onNodeWithContentDescription(spoken(readers)).assertIsDisplayed()
        compose.onAllNodesWithText("+", substring = true, useUnmergedTree = true).assertCountEquals(0)
    }

    @Test
    fun fourFacesShowNoMoreMark() {
        show(listOf(anna, bjorn), item(1u, readHere = crowd.take(4)))
        compose.onAllNodesWithText("+", substring = true, useUnmergedTree = true).assertCountEquals(0)
    }

    @Test
    fun fiveOrMoreShowFourAndPlusN() {
        show(listOf(anna, bjorn), item(1u, readHere = crowd))
        compose.onNodeWithText(text(R.string.read_by_more).format(2), useUnmergedTree = true).assertIsDisplayed()
        // The spoken form names the two behind "+2" as well.
        compose.onNodeWithContentDescription(spoken(crowd)).assertIsDisplayed()
    }

    @Test
    fun facesSitUnderAMessageWhoeverWroteItAndReplaceTheCount() {
        show(listOf(anna, bjorn), item(1u, own = true, readBy = 2u, readHere = listOf(anna)))
        compose.onNodeWithContentDescription(spoken(listOf(anna))).assertIsDisplayed()
        compose.onAllNodesWithText(text(R.string.read_marker), substring = true).assertCountEquals(0)
        val count = context.resources.getQuantityString(R.plurals.read_by_count, 2, 2)
        compose.onAllNodesWithText(count, substring = true).assertCountEquals(0)
    }

    @Test
    fun theRowIsAButtonOfAtLeast48dp() {
        show(listOf(anna, bjorn), item(1u, readHere = listOf(anna)))
        val node = compose.onNodeWithContentDescription(spoken(listOf(anna)))
        node.assert(SemanticsMatcher("is a button") { it.config.getOrNull(SemanticsProperties.Role) != null })
        val bounds = node.getBoundsInRoot()
        assertTrue((bounds.bottom - bounds.top).value >= 48f)
        assertTrue((bounds.right - bounds.left).value >= 48f)
    }

    @Test
    fun pressingItOpensASheetNamingEveryone() {
        show(listOf(anna, bjorn), item(1u, readHere = crowd))
        compose.onNodeWithContentDescription(spoken(crowd)).performClick()
        compose.onNodeWithText(text(R.string.read_by_title)).assertIsDisplayed()
        crowd.forEach { compose.onNodeWithText(it.name!!, substring = true).assertExists() }
    }

    /** A group with faces under a message, four and then "+N" (0125). */
    @Test
    fun screenshotOfAGroupWithFaces() {
        show(
            listOf(anna) + crowd,
            item(1u, readHere = listOf(anna)),
            item(2u, own = true, readHere = crowd),
        )
        compose.onRoot().captureRoboImage()
    }

    @Test
    fun aOneToOneKeepsTheWordAndDrawsNoFace() {
        show(listOf(anna), item(1u, own = true, readBy = 1u, readHere = listOf(anna)))
        compose.onNodeWithText(text(R.string.read_marker), substring = true).assertIsDisplayed()
        compose.onAllNodesWithContentDescription(spoken(listOf(anna)), substring = true).assertCountEquals(0)
    }

    @Test
    fun theFaceSplitIsFourThenTheRest() {
        assertEquals(0 to 0, readFaces(emptyList()).let { it.first.size to it.second })
        assertEquals(4 to 0, readFaces(crowd.take(4)).let { it.first.size to it.second })
        assertEquals(4 to 2, readFaces(crowd).let { it.first.size to it.second })
    }
}
