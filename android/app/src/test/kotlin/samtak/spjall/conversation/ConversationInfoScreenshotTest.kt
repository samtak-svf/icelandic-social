package samtak.spjall.conversation

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
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
import samtak.spjall.core.Mute
import samtak.spjall.core.MuteFor
import samtak.spjall.core.Person
import samtak.spjall.socket.item
import samtak.spjall.ui.clockTime
import java.util.TimeZone
import android.graphics.Color as AndroidColor

/**
 * A conversation's information screen (0055): who it is with, each setting with its state, and the
 * photos and files sent in it. Rewrite the images with `./gradlew recordRoborazziDebug` when a
 * change is meant.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [SCREENSHOT_SDK], qualifiers = SCREENSHOT_DEVICE, fontScale = 1f)
class ConversationInfoScreenshotTest {
    @get:Rule
    val folder = TemporaryFolder()

    @get:Rule val compose = createComposeRule()

    private val calls = mutableListOf<String>()

    private val actions =
        object : ConversationInfoActions {
            override fun back() {
                calls += "back"
            }

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

            override fun fetch(item: Item) = Unit

            override fun open(item: Item) {
                calls += "open ${item.seq}"
            }

            override fun more() = Unit

            override fun retry() = Unit
        }

    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    private val anna = Person("a2", "Anna Jónsdóttir", true)
    private val bjorn = Person("a3", "Björn Sigurðsson", false)

    // Times show on a 24-hour clock in the device's zone; fixing it keeps the images still.
    private val savedZone = TimeZone.getDefault()

    @Before
    fun fixZone() = TimeZone.setDefault(TimeZone.getTimeZone("Atlantic/Reykjavik"))

    @After
    fun restoreZone() = TimeZone.setDefault(savedZone)

    private fun media(
        seq: ULong,
        mime: String,
        name: String? = null,
    ) = item(seq, sender = anna, ts = PAST + seq * 60_000uL, content = Content.Media(mime, 182_000uL, null, name))

    private fun show(
        members: List<Person> = listOf(anna),
        mute: Mute = Mute.Off,
        timer: UInt? = null,
        shared: List<Item> = emptyList(),
        state: ConversationState = ConversationState.ACTIVE,
    ) {
        val path = landscape()
        val conversation = Conversation("c1", state, members, null, 0u, timer, mute)
        val ready = shared.filter { it.isPhoto() }.associate { it.seq!! to ConversationViewModel.Media.Ready(path) }
        compose.setContent {
            DecodingTheme {
                ConversationInfoScreen(
                    ConversationViewModel.State(
                        conversation = conversation,
                        loaded = true,
                        shared = ConversationViewModel.Shared(shared, loaded = true, more = false),
                        media = ready,
                    ),
                    actions,
                )
            }
        }
        compose.waitForIdle()
    }

    private val sent =
        listOf(
            media(6u, "image/jpeg"),
            media(5u, "application/pdf", "skýrsla.pdf"),
            media(4u, "image/jpeg"),
            media(3u, "image/png"),
            media(2u, "image/jpeg"),
        )

    @Test
    fun aPerson() {
        show(mute = Mute.Until(PAST + 3_600_000uL), timer = 86_400u, shared = sent)
        compose.onRoot().captureRoboImage()
    }

    @Test
    @Config(qualifiers = "+night")
    fun aPersonAtNight() {
        show(mute = Mute.Until(PAST + 3_600_000uL), timer = 86_400u, shared = sent)
        compose.onRoot().captureRoboImage()
    }

    @Test
    fun aGroupWithNothingShared() {
        show(members = listOf(anna, bjorn), mute = Mute.Always)
        compose.onRoot().captureRoboImage()
    }

    @Test
    @Config(qualifiers = "+night")
    fun aGroupWithNothingSharedAtNight() {
        show(members = listOf(anna, bjorn), mute = Mute.Always)
        compose.onRoot().captureRoboImage()
    }

    @Test
    fun eachSettingSaysItsState() {
        show(mute = Mute.Until(PAST + 3_600_000uL))
        compose.onNodeWithText(context.getString(R.string.disappearing_off)).assertExists()
        compose
            .onNodeWithText(context.getString(R.string.muted_until, clockTime(PAST + 3_600_000uL)))
            .assertExists()
        compose.onNodeWithText(context.getString(R.string.unmute)).performClick()
        assertEquals(listOf("unmute"), calls)
    }

    @Test
    fun notMutedTheRowOffersTheDurations() {
        show()
        // Neither the timer nor mute is on, and each row says so.
        compose.onAllNodesWithText(context.getString(R.string.mute_off)).assertCountEquals(2)
        compose.onNodeWithText(context.getString(R.string.mute)).performClick()
        compose.onNodeWithText(context.getString(R.string.mute_hour)).performClick()
        assertEquals(listOf("mute HOUR"), calls)
    }

    // The dialog alone: the action in danger, cancel in the text colour beside it.
    @Test
    fun theBlockDialog() {
        show()
        compose.onNodeWithText(context.getString(R.string.block)).performClick()
        compose.onNode(isDialog()).captureRoboImage()
    }

    @Test
    @Config(qualifiers = "+night")
    fun theBlockDialogAtNight() {
        show()
        compose.onNodeWithText(context.getString(R.string.block)).performClick()
        compose.onNode(isDialog()).captureRoboImage()
    }

    @Test
    fun blockAsksFirst() {
        show()
        compose.onNodeWithText(context.getString(R.string.block)).performClick()
        assertEquals(emptyList<String>(), calls)
        compose.onNodeWithText(context.getString(R.string.block_confirm, anna.name)).assertExists()
    }

    @Test
    fun aGroupOffersNoBlock() {
        show(members = listOf(anna, bjorn))
        compose.onNodeWithText(context.getString(R.string.block)).assertDoesNotExist()
        compose.onNodeWithText(bjorn.name!!).assertExists()
    }

    @Test
    fun aTapOpensAPhotoOrAFile() {
        show(shared = sent)
        compose.onNodeWithText("skýrsla.pdf").performClick()
        compose.onAllNodes(hasClickLabel(context.getString(R.string.photo)))[0].performClick()
        assertEquals(listOf("open 5", "open 6"), calls)
    }

    @Test
    fun aConversationLeftGoesBack() {
        show(state = ConversationState.REMOVED)
        assertEquals(listOf("back"), calls)
    }

    /** A small landscape photo, drawn here so the file holds no real one. */
    private fun landscape(): String {
        val bitmap = Bitmap.createBitmap(PHOTO_W, PHOTO_H, Bitmap.Config.ARGB_8888)
        val paint =
            Paint().apply {
                shader =
                    LinearGradient(
                        0f,
                        0f,
                        0f,
                        PHOTO_H.toFloat(),
                        AndroidColor.rgb(0x7F, 0xA7, 0xC9),
                        AndroidColor.rgb(0xE8, 0xC3, 0x9E),
                        Shader.TileMode.CLAMP,
                    )
            }
        Canvas(bitmap).drawRect(0f, 0f, PHOTO_W.toFloat(), PHOTO_H.toFloat(), paint)
        val file = folder.newFile("photo.jpg")
        file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, PHOTO_QUALITY, it) }
        return file.path
    }

    private companion object {
        // 14 November 2023, 22:13 in Reykjavík.
        const val PAST = 1_700_000_000_000uL
        const val PHOTO_W = 400
        const val PHOTO_H = 300
        const val PHOTO_QUALITY = 90
    }
}
