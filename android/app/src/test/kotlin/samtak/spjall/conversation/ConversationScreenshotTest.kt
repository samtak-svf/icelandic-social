package samtak.spjall.conversation

import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import com.github.takahirom.roborazzi.captureRoboImage
import com.github.takahirom.roborazzi.captureScreenRoboImage
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import samtak.spjall.brand.R
import samtak.spjall.conversations.SCREENSHOT_DEVICE
import samtak.spjall.conversations.SCREENSHOT_SDK
import samtak.spjall.core.Content
import samtak.spjall.core.Conversation
import samtak.spjall.core.ConversationState
import samtak.spjall.core.Item
import samtak.spjall.core.ItemStatus
import samtak.spjall.core.Mute
import samtak.spjall.core.MuteFor
import samtak.spjall.core.Person
import samtak.spjall.ui.SpjallTheme
import java.util.TimeZone

/**
 * What one conversation looks like in the states 0043 names: the composer's one action, the
 * clock of a pending message, a shared post's line and the information sheet. Rewrite the
 * images with `./gradlew recordRoborazziDebug` when a change is meant.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [SCREENSHOT_SDK], qualifiers = SCREENSHOT_DEVICE, fontScale = 1f)
class ConversationScreenshotTest {
    @get:Rule val compose = createComposeRule()

    private val actions =
        object : ConversationActions {
            override fun back() = Unit

            override fun draft(text: String) = Unit

            override fun send() = Unit

            override fun reply(item: Item) = Unit

            override fun forward(item: Item) = Unit

            override fun edit(item: Item) = Unit

            override fun cancelMode() = Unit

            override fun delete(item: Item) = Unit

            override fun react(
                item: Item,
                emoji: String,
            ) = Unit

            override fun resend() = Unit

            override fun loadOlder() = Unit

            override fun attachPhoto() = Unit

            override fun attachFile() = Unit

            override fun fetch(item: Item) = Unit

            override fun open(item: Item) = Unit

            override fun timer(seconds: UInt?) = Unit

            override fun mute(duration: MuteFor) = Unit

            override fun unmute() = Unit

            override fun block() = Unit

            override fun retry() = Unit

            override fun paused() = Unit
        }

    private val anna = Person("a2", "Anna Jónsdóttir", true)
    private val me = Person("a1", "Jón Jónsson", true)

    // Times show on a 24-hour clock in the device's zone; fixing it keeps the images still.
    private val savedZone = TimeZone.getDefault()

    @Before
    fun fixZone() = TimeZone.setDefault(TimeZone.getTimeZone("Atlantic/Reykjavik"))

    @After
    fun restoreZone() = TimeZone.setDefault(savedZone)

    private fun item(
        seq: ULong?,
        content: Content,
        own: Boolean = false,
        status: ItemStatus = ItemStatus.SENT,
    ) = Item(
        seq,
        seq?.let { "e$it" },
        if (own) me else anna,
        own,
        PAST + (seq ?: 9uL) * 1_000uL,
        status,
        content,
        false,
        emptyList(),
        0u,
        null,
        false,
    )

    private fun show(
        vararg items: Item,
        draft: String = "",
    ) = compose.setContent {
        SpjallTheme {
            ConversationScreen(
                ConversationViewModel.State(
                    conversation =
                        Conversation(
                            "c1",
                            ConversationState.ACTIVE,
                            listOf(anna),
                            null,
                            0u,
                            3_600u,
                            Mute.Off,
                        ),
                    items = items.toList(),
                    loaded = true,
                    draft = draft,
                ),
                actions,
            )
        }
    }

    @Test
    fun emptyComposerOffersAttach() {
        show(item(1u, Content.Text("Sæl", null)))
        compose.onRoot().captureRoboImage()
    }

    @Test
    fun composerWithTextOffersSend() {
        show(item(1u, Content.Text("Sæl", null)), draft = "Hæ")
        compose.onRoot().captureRoboImage()
    }

    @Test
    fun pendingMessageShowsAClock() {
        show(
            item(1u, Content.Text("Sæl", null)),
            item(null, Content.Text("Á leiðinni", null), own = true, status = ItemStatus.PENDING),
        )
        compose.onRoot().captureRoboImage()
    }

    @Test
    fun sharedPostSaysItIsGone() {
        show(item(1u, Content.Post("p1")))
        compose.onRoot().captureRoboImage()
    }

    @Test
    fun informationSheet() {
        show(item(1u, Content.Text("Sæl", null)))
        val label = InstrumentationRegistry.getInstrumentation().targetContext.getString(R.string.conversation_info)
        compose
            .onNode(hasClickLabel(label) and SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Button))
            .performClick()
        compose.waitForIdle()
        // The sheet is a window of its own, so the whole screen is captured.
        captureScreenRoboImage()
    }

    private companion object {
        // 14 November 2023, 22:13 in Reykjavík.
        const val PAST = 1_700_000_000_000uL
    }
}

/** The node a tap acts on, named for TalkBack by [label]. */
internal fun hasClickLabel(label: String) =
    SemanticsMatcher("click label $label") { it.config.getOrNull(SemanticsActions.OnClick)?.label == label }
