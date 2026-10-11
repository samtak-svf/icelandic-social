package samtak.spjall.conversations

import android.content.Context
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onRoot
import androidx.test.core.app.ApplicationProvider
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.After
import org.junit.Before
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
import samtak.spjall.core.MuteFor
import samtak.spjall.core.Person
import samtak.spjall.socket.Connection
import samtak.spjall.ui.SpjallTheme
import java.util.TimeZone

/**
 * What the conversation list looks like, compared pixel by pixel with the images in
 * src/test/screenshots/. Catches a change to padding, colour, type or icon that no assertion
 * on text would see. Rewrite the images with `./gradlew recordRoborazziDebug` when a change is
 * meant, and look at the diff before committing them.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [SCREENSHOT_SDK], qualifiers = SCREENSHOT_DEVICE, fontScale = 1f)
class ConversationsScreenshotTest {
    @get:Rule val compose = createComposeRule()

    private val actions =
        object : ConversationsActions {
            override fun open(conversation: String) = Unit

            override fun newConversation() = Unit

            override fun search(text: String) = Unit

            override fun openPerson(account: String) = Unit

            override fun invite() = Unit

            override fun retry() = Unit

            override fun notificationSettings() = Unit

            override fun mute(
                conversation: String,
                duration: MuteFor,
            ) = Unit

            override fun unmute(conversation: String) = Unit
        }

    private val anna = Person("a2", "Anna Jónsdóttir", true)
    private val bjarni = Person("a3", "Bjarni Pálsson", false)

    // The row stamps a message by how long ago it was; one from a past year shows its date, the
    // same on any day the test runs, once the zone is fixed.
    private val savedZone = TimeZone.getDefault()

    @Before
    fun fixZone() = TimeZone.setDefault(TimeZone.getTimeZone("Atlantic/Reykjavik"))

    @After
    fun restoreZone() = TimeZone.setDefault(savedZone)

    private fun last(
        sender: Person,
        line: String,
    ) = Item(
        1uL,
        "e1",
        sender,
        false,
        PAST,
        ItemStatus.SENT,
        Content.Text(line, null),
        false,
        emptyList(),
        0u,
        null,
        false,
    )

    private fun row(
        id: String,
        person: Person,
        line: String,
        unread: UInt,
        mute: Mute = Mute.Off,
    ) = Conversation(id, ConversationState.ACTIVE, listOf(person), last(person, line), unread, null, mute)

    private fun shoot(state: ConversationsViewModel.State) {
        compose.setContent { SpjallTheme { ConversationsScreen(state, actions) } }
        compose.onRoot().captureRoboImage()
    }

    /** Before the first read: grey rows, read out once as loading (0043). */
    @Test
    fun placeholders() {
        shoot(ConversationsViewModel.State(connection = Connection.Online))
        val loading = ApplicationProvider.getApplicationContext<Context>().getString(R.string.loading)
        compose.onNodeWithContentDescription(loading).assertExists()
    }

    @Test
    fun empty() = shoot(ConversationsViewModel.State(loaded = true, connection = Connection.Online))

    @Test
    fun unread() =
        shoot(
            ConversationsViewModel.State(
                conversations =
                    listOf(
                        row("c1", anna, "Sæl", 3u),
                        row("c2", bjarni, "Takk", 0u),
                    ),
                loaded = true,
                connection = Connection.Online,
            ),
        )

    @Test
    fun muted() =
        shoot(
            ConversationsViewModel.State(
                conversations =
                    listOf(
                        row("c1", anna, "Sæl", 2u, Mute.Always),
                        row("c2", bjarni, "Takk", 0u),
                    ),
                loaded = true,
                connection = Connection.Online,
            ),
        )

    private fun own(
        id: String,
        members: List<Person>,
        status: ItemStatus,
        readBy: UInt = 0u,
    ) = Conversation(
        id,
        ConversationState.ACTIVE,
        members,
        Item(2uL, "e2", anna, true, PAST, status, Content.Text("Takk", null), false, emptyList(), readBy, null, false),
        0u,
        null,
        Mute.Off,
    )

    /** A 1:1 and a group, each with someone typing: the group's row names no one (0043). */
    @Test
    fun typing() =
        shoot(
            ConversationsViewModel.State(
                conversations =
                    listOf(
                        row("c1", anna, "Sæl", 0u),
                        Conversation(
                            "c2",
                            ConversationState.ACTIVE,
                            listOf(anna, bjarni),
                            last(bjarni, "Já"),
                            0u,
                            null,
                            Mute.Off,
                        ),
                    ),
                loaded = true,
                connection = Connection.Online,
                typing = setOf("c1", "c2"),
            ),
        )

    /** The reader's own last message: on its way, failed, read in a 1:1, read by two in a group (0043). */
    @Test
    fun ownStates() =
        shoot(
            ConversationsViewModel.State(
                conversations =
                    listOf(
                        own("c1", listOf(anna), ItemStatus.PENDING),
                        own("c2", listOf(bjarni), ItemStatus.FAILED),
                        own("c3", listOf(anna), ItemStatus.SENT, readBy = 1u),
                        own("c4", listOf(anna, bjarni), ItemStatus.SENT, readBy = 2u),
                    ),
                loaded = true,
                connection = Connection.Online,
            ),
        )

    private companion object {
        // 14 November 2023, 22:13 in Reykjavík.
        const val PAST = 1_700_000_000_000uL
    }
}

/** The Android version the screenshots are rendered on; a new one is a new set of images. */
const val SCREENSHOT_SDK = 36

/** Icelandic, on a Pixel 5's screen (Robolectric's RobolectricDeviceQualifiers.Pixel5). */
const val SCREENSHOT_DEVICE = "is-w393dp-h851dp-normal-long-notround-any-440dpi-keyshidden-nonav"
