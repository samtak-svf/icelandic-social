package samtak.spjall.conversation

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Assert.assertEquals
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
import samtak.spjall.ui.FilePhotos
import samtak.spjall.ui.IcelandZone
import samtak.spjall.ui.LocalPhotos
import samtak.spjall.ui.clockTime
import samtak.spjall.ui.squarePhoto
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

    @get:Rule val zone = IcelandZone()

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

            override fun open(item: Item) {
                calls += "open ${item.seq}"
            }

            override fun more() = Unit

            override fun retry() = Unit
        }

    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    private val anna = Person("a2", "Anna Jónsdóttir", true)
    private val bjorn = Person("a3", "Björn Sigurðsson", false)

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
        name: String? = null,
        photo: String? = null,
    ) {
        val path = landscape()
        val conversation = Conversation("c1", state, name, photo, members, null, 0u, timer, mute)
        val ready = shared.filter { it.isPhoto() }.associate { it.seq!! to ConversationViewModel.Media.Ready(path) }
        compose.setContent {
            DecodingTheme {
                CompositionLocalProvider(LocalPhotos provides FilePhotos) {
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

    /** A group's own photo (0094), drawn here, with the way to change or remove it and who sees it. */
    @Test
    fun aGroupWithAPhoto() {
        show(members = listOf(anna, bjorn), name = "Bókaklúbbur", photo = groupPhoto())
        compose.onNodeWithContentDescription(context.getString(R.string.group_photo_alt)).assertExists()
        compose.onRoot().captureRoboImage()
    }

    @Test
    @Config(qualifiers = "+night")
    fun aGroupWithAPhotoAtNight() {
        show(members = listOf(anna, bjorn), name = "Bókaklúbbur", photo = groupPhoto())
        compose.onRoot().captureRoboImage()
    }

    @Test
    fun aGroupWithoutAPhotoOffersToChooseOne() {
        show(members = listOf(anna, bjorn))
        compose.onNodeWithText(context.getString(R.string.group_photo_seen_by_members)).assertExists()
        compose.onNodeWithText(context.getString(R.string.group_photo_change)).assertDoesNotExist()
        compose.onNodeWithText(context.getString(R.string.group_photo_remove)).assertDoesNotExist()
        compose.onNodeWithContentDescription(context.getString(R.string.group_photo_alt)).assertDoesNotExist()
        compose.onNodeWithText(context.getString(R.string.group_photo_choose)).performClick()
        assertEquals(listOf("setPhoto"), calls)
    }

    @Test
    fun aGroupWithAPhotoChangesItAndRemovesItAfterAsking() {
        show(members = listOf(anna, bjorn), photo = groupPhoto())
        compose.onNodeWithText(context.getString(R.string.group_photo_choose)).assertDoesNotExist()
        compose.onNodeWithText(context.getString(R.string.group_photo_change)).performClick()
        compose.onNodeWithText(context.getString(R.string.group_photo_remove)).performClick()
        assertEquals("nothing is removed before the person agrees", listOf("setPhoto"), calls)
        inDialog(context.getString(R.string.group_photo_remove_confirm)).assertExists()
        inDialog(context.getString(R.string.group_photo_remove)).performClick()
        assertEquals(listOf("setPhoto", "clearPhoto"), calls)
    }

    @Test
    fun aOneToOneOffersNoPhotoControl() {
        show()
        compose.onNodeWithText(context.getString(R.string.group_photo_choose)).assertDoesNotExist()
        compose.onNodeWithText(context.getString(R.string.group_photo_change)).assertDoesNotExist()
        compose.onNodeWithText(context.getString(R.string.group_photo_seen_by_members)).assertDoesNotExist()
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

    /** A group this account left has no menu to open, so its information closes too (0078). */
    @Test
    fun aGroupLeftGoesBack() {
        show(members = listOf(anna, bjorn), state = ConversationState.LEFT)
        assertEquals(listOf("back"), calls)
    }

    // A group's own actions, above its members (0078): more people, and its name.
    @Test
    fun aGroupOffersItsOwnActions() {
        show(members = listOf(anna, bjorn))
        compose.onNodeWithText(context.getString(R.string.add_people)).performClick()
        compose.onNodeWithText(context.getString(R.string.group_name)).assertExists()
        assertEquals(listOf("add"), calls)
    }

    @Test
    fun aOneToOneOffersNeitherOfThem() {
        show()
        compose.onNodeWithText(context.getString(R.string.add_people)).assertDoesNotExist()
        compose.onNodeWithText(context.getString(R.string.group_name)).assertDoesNotExist()
    }

    /** A group is titled by its name once it has one, whatever its members are (0078). */
    @Test
    fun aNamedGroupIsTitledByItsName() {
        show(members = listOf(anna, bjorn), name = "Fjölskyldan")
        compose.onNodeWithText("Fjölskyldan").assertExists()
    }

    @Test
    fun theGroupNameDialogIsNotDrawnHere() {
        // Robolectric never reports a screen with a text field inside a dialog window as idle (measured:
        // OutlinedTextField, a disabled one and a bare BasicTextField all spin for 60 s), so the name
        // dialog's own tests are on a device: ConversationInfoScreenTest.
        show(members = listOf(anna, bjorn))
        compose.onNodeWithText(context.getString(R.string.group_name)).assertExists()
    }

    @Test
    fun theRemoveMemberDialog() {
        show(members = listOf(anna, bjorn))
        compose.onNodeWithText(context.getString(R.string.remove_member_confirm, anna.name)).assertDoesNotExist()
        compose.onAllNodesWithContentDescription(context.getString(R.string.remove_member))[0].performClick()
        compose.onNode(isDialog()).captureRoboImage()
    }

    @Test
    fun removingAMemberAsksFirst() {
        show(members = listOf(anna, bjorn))
        compose.onAllNodesWithContentDescription(context.getString(R.string.remove_member))[0].performClick()
        assertEquals(emptyList<String>(), calls)
        compose.onNodeWithText(context.getString(R.string.remove_member_confirm, anna.name)).assertExists()
        inDialog(context.getString(R.string.remove_member)).performClick()
        assertEquals(listOf("remove a2"), calls)
    }

    @Test
    fun theLeaveDialog() {
        show(members = listOf(anna, bjorn))
        compose.onNodeWithText(context.getString(R.string.leave_group)).performClick()
        compose.onNode(isDialog()).captureRoboImage()
    }

    @Test
    fun leavingAGroupAsksFirst() {
        show(members = listOf(anna, bjorn))
        compose.onNodeWithText(context.getString(R.string.leave_group)).performClick()
        assertEquals(emptyList<String>(), calls)
        compose.onNodeWithText(context.getString(R.string.leave_group_confirm)).assertExists()
        inDialog(context.getString(R.string.leave_group)).performClick()
        assertEquals(listOf("leave"), calls)
    }

    /** The one node with [text] that is inside the dialog, which may say the same words as the row that opened it. */
    private fun inDialog(text: String) = compose.onNode(hasText(text) and hasAnyAncestor(isDialog()))

    /** A group's photo as the core keeps it, drawn here (0094). */
    private fun groupPhoto(): String =
        squarePhoto(folder.newFile("group.jpg"), AndroidColor.rgb(0x6B, 0x8F, 0x71), AndroidColor.rgb(0xD9, 0xB3, 0x8C))

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
