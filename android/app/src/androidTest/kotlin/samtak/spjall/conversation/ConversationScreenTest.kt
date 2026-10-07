package samtak.spjall.conversation

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.longClick
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
import samtak.spjall.core.Person
import samtak.spjall.core.Quote
import samtak.spjall.core.Reaction
import samtak.spjall.ui.SpjallTheme

@RunWith(AndroidJUnit4::class)
class ConversationScreenTest {
    @get:Rule val compose = createComposeRule()

    private val calls = mutableListOf<String>()
    private val actions =
        object : ConversationActions {
            override fun back() {
                calls += "back"
            }

            override fun draft(text: String) {
                calls += "draft $text"
            }

            override fun send() {
                calls += "send"
            }

            override fun reply(item: Item) {
                calls += "reply ${item.seq}"
            }

            override fun edit(item: Item) {
                calls += "edit ${item.seq}"
            }

            override fun cancelMode() {
                calls += "cancelMode"
            }

            override fun delete(item: Item) {
                calls += "delete ${item.seq}"
            }

            override fun react(
                item: Item,
                emoji: String,
            ) {
                calls += "react ${item.seq} $emoji"
            }

            override fun resend() {
                calls += "resend"
            }

            override fun loadOlder() = Unit

            override fun retry() {
                calls += "retry"
            }

            override fun paused() = Unit
        }

    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    private fun text(id: Int) = context.getString(id)

    private val anna = Person("a2", "Anna Jónsdóttir", true)
    private val me = Person("a1", "Jón Jónsson", true)

    private fun item(
        seq: ULong?,
        content: Content,
        own: Boolean = false,
        status: ItemStatus = ItemStatus.SENT,
        edited: Boolean = false,
        reactions: List<Reaction> = emptyList(),
        readBy: UInt = 0u,
    ) = Item(
        seq,
        seq?.let { "e$it" },
        if (own) me else anna,
        own,
        1_700_000_000_000uL + (seq ?: 9uL) * 1_000uL,
        status,
        content,
        edited,
        reactions,
        readBy,
        null,
    )

    private fun show(
        vararg items: Item,
        state: ConversationState = ConversationState.ACTIVE,
        members: List<Person> = listOf(anna),
        typing: Boolean = false,
        draft: String = "",
    ) = compose.setContent {
        SpjallTheme {
            ConversationScreen(
                ConversationViewModel.State(
                    conversation = Conversation("c1", state, members, null, 0u, null),
                    items = items.toList(),
                    loaded = true,
                    typing = typing,
                    draft = draft,
                ),
                actions,
            )
        }
    }

    @Test
    fun bubblesShowRepliesEditsTombstonesAndTheReadLine() {
        show(
            item(1u, Content.Text("Sæl", null)),
            item(2u, Content.Text("Já, sæl", Quote("e1", anna, "Sæl")), own = true, edited = true, readBy = 1u),
            item(3u, Content.Deleted),
            typing = true,
        )
        // The title and the quote; a 1:1 puts no name over the bubbles.
        compose.onAllNodesWithText("Anna Jónsdóttir").assertCountEquals(2)
        compose.onNodeWithText("Já, sæl", substring = true).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.edited_marker), substring = true).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.message_deleted)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.read_marker)).assertIsDisplayed()
        compose
            .onNodeWithText(context.getString(R.string.typing_indicator, "Anna Jónsdóttir"))
            .assertIsDisplayed()
    }

    @Test
    fun aGroupNamesTheSenderAndCountsReaders() {
        val other = Person("a3", "Björn", false)
        show(
            item(1u, Content.Text("Halló", null)),
            item(2u, Content.Text("Hæ", null), own = true, readBy = 2u),
            members = listOf(anna, other),
            typing = true,
        )
        compose.onNodeWithText("Anna Jónsdóttir").assertIsDisplayed()
        compose
            .onNodeWithText(context.resources.getQuantityString(R.plurals.read_by_count, 2, 2))
            .assertIsDisplayed()
        compose.onNodeWithText(text(R.string.typing_indicator_group)).assertIsDisplayed()
    }

    @Test
    fun longPressOnTheirMessageOffersReplyAndReactionsOnly() {
        show(item(1u, Content.Text("Sæl", null)))
        compose.onNodeWithText("Sæl", substring = true).performTouchInput { longClick() }
        compose.onNodeWithText(text(R.string.edit)).assertDoesNotExist()
        compose.onNodeWithText(text(R.string.delete_for_everyone)).assertDoesNotExist()
        compose.onNodeWithText("👍").performClick()
        compose.onNodeWithText("Sæl", substring = true).performTouchInput { longClick() }
        compose.onNodeWithText(text(R.string.reply)).performClick()
        assertEquals(listOf("react 1 👍", "reply 1"), calls)
    }

    @Test
    fun deletingOwnMessageAsksFirst() {
        show(item(2u, Content.Text("Úps", null), own = true))
        compose.onNodeWithText("Úps", substring = true).performTouchInput { longClick() }
        compose.onNodeWithText(text(R.string.edit)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.delete_for_everyone)).performClick()
        compose.onNodeWithText(text(R.string.delete_confirm)).assertIsDisplayed()
        assertEquals(emptyList<String>(), calls)
        compose.onNodeWithText(text(R.string.delete_for_everyone)).performClick()
        assertEquals(listOf("delete 2"), calls)
    }

    @Test
    fun aBubbleCarriesItsActionsForTalkBack() {
        show(item(2u, Content.Text("Úps", null), own = true))
        val labels =
            compose
                .onNodeWithText("Úps", substring = true)
                .fetchSemanticsNode()
                .config
                .getOrNull(SemanticsActions.CustomActions)
                ?.map { it.label }
        assertEquals(
            listOf(R.string.reply, R.string.edit, R.string.delete_for_everyone, R.string.react).map(::text),
            labels,
        )
    }

    @Test
    fun reactionChipsToggleAndAFailedMessageCanBeSentAgain() {
        show(
            item(1u, Content.Text("Sæl", null), reactions = listOf(Reaction("❤️", true, listOf(me)))),
            item(null, Content.Text("Týnt", null), own = true, status = ItemStatus.FAILED),
        )
        compose.onNodeWithText("❤️ 1").performClick()
        compose.onNodeWithText(text(R.string.message_failed)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.try_again)).performClick()
        assertEquals(listOf("react 1 ❤️", "resend"), calls)
    }

    @Test
    fun theComposerDraftsAndSends() {
        show(draft = "")
        compose.onNodeWithContentDescription(text(R.string.send)).assertIsNotEnabled()
        compose.onNodeWithText(text(R.string.composer_placeholder)).performTextInput("H")
        assertEquals(listOf("draft H"), calls)
    }

    @Test
    fun aDraftCanBeSent() {
        show(draft = "Halló")
        compose.onNodeWithContentDescription(text(R.string.send)).assertIsEnabled().performClick()
        assertEquals(listOf("send"), calls)
    }

    @Test
    fun aRemovedConversationIsReadOnly() {
        show(item(1u, Content.Text("Sæl", null)), state = ConversationState.REMOVED)
        compose.onNodeWithText(text(R.string.conversation_removed_banner)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.composer_placeholder)).assertDoesNotExist()
        compose.onNodeWithContentDescription(text(R.string.back)).performClick()
        assertEquals(listOf("back"), calls)
    }
}
