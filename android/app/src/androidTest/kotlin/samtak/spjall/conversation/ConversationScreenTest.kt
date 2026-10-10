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
import samtak.spjall.core.Mute
import samtak.spjall.core.Person
import samtak.spjall.core.Post
import samtak.spjall.core.Quote
import samtak.spjall.core.Reaction
import samtak.spjall.core.ReactionCounts
import samtak.spjall.ui.SpjallTheme
import samtak.spjall.ui.clockTime

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

            override fun attachPhoto() {
                calls += "attachPhoto"
            }

            override fun attachFile() {
                calls += "attachFile"
            }

            override fun fetch(item: Item) {
                calls += "fetch ${item.seq}"
            }

            override fun open(item: Item) {
                calls += "open ${item.seq}"
            }

            override fun showPost(postId: String) {
                calls += "showPost $postId"
            }

            override fun openPost(postId: String) {
                calls += "openPost $postId"
            }

            override fun timer(seconds: UInt?) {
                calls += "timer $seconds"
            }

            override fun block() {
                calls += "block"
            }

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
        forwarded: Boolean = false,
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
        forwarded,
    )

    private fun show(
        vararg items: Item,
        state: ConversationState = ConversationState.ACTIVE,
        members: List<Person> = listOf(anna),
        typing: Boolean = false,
        draft: String = "",
        media: Map<ULong, ConversationViewModel.Media> = emptyMap(),
        posts: Map<String, ConversationViewModel.Shared> = emptyMap(),
        timer: UInt? = null,
    ) = compose.setContent {
        SpjallTheme {
            ConversationScreen(
                ConversationViewModel.State(
                    conversation = Conversation("c1", state, members, null, 0u, timer, Mute.Off),
                    items = items.toList(),
                    loaded = true,
                    typing = typing,
                    draft = draft,
                    media = media,
                    posts = posts,
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
        compose.onNodeWithText(text(R.string.read_marker), substring = true).assertIsDisplayed()
        compose
            .onNodeWithContentDescription(context.getString(R.string.typing_indicator, "Anna Jónsdóttir"))
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
            .onNodeWithText(context.resources.getQuantityString(R.plurals.read_by_count, 2, 2), substring = true)
            .assertIsDisplayed()
        compose.onNodeWithContentDescription(text(R.string.typing_indicator_group)).assertIsDisplayed()
    }

    @Test
    fun theTimeGoesOnceUnderTheEndOfARun() {
        val second = item(2u, Content.Text("Ertu við?", null))
        show(item(1u, Content.Text("Sæl", null)), second)
        // The two are a second apart: one clock, under the second, on a 24-hour clock.
        compose.onAllNodesWithText(clockTime(second.ts)).assertCountEquals(1)
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

    @Test
    fun theTimerIsPickedFromTheMenu() {
        show(item(1u, Content.Text("Sæl", null)), timer = 3_600u)
        compose.onNodeWithContentDescription(text(R.string.more_options)).performClick()
        compose.onNodeWithText(text(R.string.disappearing_messages)).performClick()
        val hour = context.resources.getQuantityString(R.plurals.duration_hours, 1, 1)
        // Picking the timer already set changes nothing.
        compose.onNodeWithText(context.getString(R.string.disappearing_option, hour)).performClick()
        assertEquals(emptyList<String>(), calls)
        compose.onNodeWithContentDescription(text(R.string.more_options)).performClick()
        compose.onNodeWithText(text(R.string.disappearing_messages)).performClick()
        compose.onNodeWithText(text(R.string.disappearing_off)).performClick()
        assertEquals(listOf("timer null"), calls)
    }

    @Test
    fun blockAsksFirstAndIsOnlyOfferedInAOneToOne() {
        show(item(1u, Content.Text("Sæl", null)))
        compose.onNodeWithContentDescription(text(R.string.more_options)).performClick()
        compose.onNodeWithText(text(R.string.block)).performClick()
        compose.onNodeWithText(context.getString(R.string.block_confirm, "Anna Jónsdóttir")).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.block)).performClick()
        assertEquals(listOf("block"), calls)
    }

    @Test
    fun aGroupMenuHasNoBlock() {
        show(item(1u, Content.Text("Sæl", null)), members = listOf(anna, Person("a3", "Björn", false)))
        compose.onNodeWithContentDescription(text(R.string.more_options)).performClick()
        compose.onNodeWithText(text(R.string.disappearing_messages)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.block)).assertDoesNotExist()
    }

    @Test
    fun attachOffersPhotoOrFile() {
        show(item(1u, Content.Text("Sæl", null)))
        compose.onNodeWithContentDescription(text(R.string.attach)).performClick()
        compose.onNodeWithText(text(R.string.photo)).performClick()
        compose.onNodeWithContentDescription(text(R.string.attach)).performClick()
        compose.onNodeWithText(text(R.string.file)).performClick()
        assertEquals(listOf("attachPhoto", "attachFile"), calls)
    }

    @Test
    fun aPhotoIsFetchedAndAFileOpensOnATap() {
        show(
            item(1u, Content.Media("image/jpeg", 10uL, "Fjallið", null)),
            item(2u, Content.Media("application/pdf", 10uL, null, "skýrsla.pdf")),
        )
        compose.waitForIdle()
        assertEquals("a photo downloads when it shows; a file waits", listOf("fetch 1"), calls)
        compose.onNodeWithText("Fjallið").assertIsDisplayed()
        compose.onNodeWithText("skýrsla.pdf").performClick()
        assertEquals(listOf("fetch 1", "open 2"), calls)
    }

    @Test
    fun aSharedPostShowsItsAuthorAndTextAndOpensOnATap() {
        val bjorn = Person("a3", "Björn Hansson", true)
        val post = Post("p1", bjorn, "Fundur í kvöld", 0uL, 0u, ReactionCounts(0u, 0u, 0u, 0u, 0u), null)
        show(
            item(1u, Content.Post("p1"), forwarded = true),
            posts = mapOf("p1" to ConversationViewModel.Shared.Found(post)),
        )
        compose.waitForIdle()
        assertEquals("the card asks for its post when it shows", listOf("showPost p1"), calls)
        compose.onNodeWithText("Björn Hansson", substring = true).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.forwarded_marker)).assertIsDisplayed()
        compose.onNodeWithText("Fundur í kvöld").performClick()
        assertEquals(listOf("showPost p1", "openPost p1"), calls)
    }

    @Test
    fun aGonePostSaysOnlyThatAndAFailedOneCanBeTriedAgain() {
        show(
            item(1u, Content.Post("p1")),
            item(2u, Content.Post("p2")),
            posts = mapOf("p1" to ConversationViewModel.Shared.Gone, "p2" to ConversationViewModel.Shared.Failed),
        )
        compose.onNodeWithText(text(R.string.post_gone)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.post_load_failed)).assertIsDisplayed()
        calls.clear()
        compose.onNodeWithText(text(R.string.try_again)).performClick()
        assertEquals(listOf("showPost p2"), calls)
    }

    @Test
    fun aReplyToAShareQuotesThePostAsItsCard() {
        val post = Post("p1", anna, "Fundur í kvöld", 0uL, 0u, ReactionCounts(0u, 0u, 0u, 0u, 0u), null)
        show(
            item(2u, Content.Text("Ég mæti", Quote("e1", anna, null, "p1")), own = true),
            posts = mapOf("p1" to ConversationViewModel.Shared.Found(post)),
        )
        compose.onNodeWithText("Fundur í kvöld", substring = true).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.message_deleted)).assertDoesNotExist()
    }

    @Test
    fun aFailedDownloadCanBeTriedAgain() {
        show(
            item(2u, Content.Media("application/pdf", 10uL, null, null)),
            media = mapOf(2uL to ConversationViewModel.Media.Failed),
        )
        compose.onNodeWithText(text(R.string.media_download_failed)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.try_again)).performClick()
        assertEquals(listOf("fetch 2"), calls)
    }
}
