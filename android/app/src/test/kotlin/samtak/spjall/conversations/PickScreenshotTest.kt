package samtak.spjall.conversations

import androidx.compose.ui.res.stringResource
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
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

/** The forward and share picker: its preview, search and empty search (decision 0043). */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [SCREENSHOT_SDK], qualifiers = SCREENSHOT_DEVICE, fontScale = 1f)
class PickScreenshotTest {
    @get:Rule val compose = createComposeRule()

    private val actions =
        object : PickActions {
            override fun toggle(conversation: String) = Unit

            override fun send() = Unit

            override fun search(text: String) = Unit

            override fun back() = Unit

            override fun retry() = Unit
        }

    private val anna = Person("a2", "Anna Jónsdóttir", true)
    private val bjarni = Person("a3", "Bjarni Pálsson", false)

    private val conversations =
        listOf(
            Conversation("c2", ConversationState.ACTIVE, listOf(anna), null, 0u, null, Mute.Off),
            Conversation("c3", ConversationState.ACTIVE, listOf(bjarni), null, 0u, null, Mute.Off),
        )

    private val message =
        Item(
            7uL,
            "e7",
            anna,
            false,
            PAST,
            ItemStatus.SENT,
            Content.Text("Sjáumst á fundinum á morgun klukkan átta.", null),
            false,
            emptyList(),
            0u,
            null,
            false,
        )

    private val post =
        Post("p1", bjarni, "Opinn fundur í kvöld í Gerðubergi.", PAST, 0u, ReactionCounts(0u, 0u, 0u, 0u, 0u), null)

    private fun shoot(
        title: Int,
        state: PickViewModel.State,
    ) {
        compose.setContent { SpjallTheme { PickScreen(stringResource(title), state, actions) } }
        compose.onRoot().captureRoboImage()
    }

    @Test
    fun forwardPreview() =
        shoot(
            R.string.forward,
            PickViewModel.State(
                conversations = conversations,
                loaded = true,
                picked = setOf("c3"),
                outgoing = Outgoing.Message(message),
            ),
        )

    @Test
    fun sharePreview() =
        shoot(
            R.string.share_post,
            PickViewModel.State(conversations = conversations, loaded = true, outgoing = Outgoing.SharedPost(post)),
        )

    @Test
    fun searchFound() =
        shoot(
            R.string.forward,
            PickViewModel.State(
                conversations = conversations,
                loaded = true,
                query = "Bj",
                found = conversations.drop(1),
                outgoing = Outgoing.Message(message),
            ),
        )

    @Test
    fun searchFoundNothing() =
        shoot(
            R.string.forward,
            PickViewModel.State(
                conversations = conversations,
                loaded = true,
                query = "zz",
                found = emptyList(),
                outgoing = Outgoing.Message(message),
            ),
        )

    private companion object {
        // 14 November 2023, 22:13 in Reykjavík.
        const val PAST = 1_700_000_000_000uL
    }
}
