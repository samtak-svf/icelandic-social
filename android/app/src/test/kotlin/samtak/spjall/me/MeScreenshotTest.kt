package samtak.spjall.me

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.dp
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import samtak.spjall.conversations.SCREENSHOT_DEVICE
import samtak.spjall.conversations.SCREENSHOT_SDK
import samtak.spjall.core.AccountDevice
import samtak.spjall.core.Me
import samtak.spjall.core.Platform
import samtak.spjall.ui.Palette
import samtak.spjall.ui.SpjallTheme
import kotlin.math.ceil

/**
 * Ég with its larger photo that opens the picker and its settings below (decisions 0043,
 * 0044), and the blocked list's empty state. See ConversationsScreenshotTest.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [SCREENSHOT_SDK], qualifiers = SCREENSHOT_DEVICE, fontScale = 1f)
class MeScreenshotTest {
    @get:Rule val compose = createComposeRule()

    private val me = Me("a1", "Jón Jónsson", true, emptyList(), null)

    @Test
    fun me() {
        compose.setContent { SpjallTheme { MeScreen(MeViewModel.State(me = me), NoMeActions()) } }
        compose.onRoot().captureRoboImage()
    }

    /** With a photo and a link, at the usual size: each pair of buttons on one line. */
    @Test
    fun everyButton() {
        compose.setContent { SpjallTheme { MeScreen(everyButton, NoMeActions()) } }
        compose.onRoot().captureRoboImage()
    }

    /** Ég in the system's dark mode (0052). */
    @Test
    @Config(qualifiers = "+night")
    fun night() {
        compose.setContent { SpjallTheme { MeScreen(MeViewModel.State(me = me), NoMeActions()) } }
        compose.onRoot().captureRoboImage()
    }

    /**
     * At twice the text size (0053): the title stays in its band and the initials in their circle, and
     * the buttons that sit side by side go one under the other instead of cutting their words.
     */
    @Test
    @Config(fontScale = 2f)
    fun largeText() {
        compose.setContent { SpjallTheme { MeScreen(everyButton, NoMeActions()) } }
        compose.onRoot().captureRoboImage()
    }

    @Test
    @Config(fontScale = 2f)
    fun noWordIsCutAtTwiceTheTextSize() {
        compose.setContent { SpjallTheme { MeScreen(everyButton, NoMeActions()) } }
        // A box narrower than the text's longest word cuts that word, and one narrower than the whole
        // text cuts it when the text may not wrap.
        val cut =
            compose.onAllNodes(hasText("", substring = true)).fetchSemanticsNodes().mapNotNull { node ->
                val layouts = mutableListOf<TextLayoutResult>()
                node.config
                    .getOrNull(SemanticsActions.GetTextLayoutResult)
                    ?.action
                    ?.invoke(layouts)
                val layout = layouts.firstOrNull() ?: return@mapNotNull null
                val intrinsics = layout.multiParagraph.intrinsics
                val needs =
                    if (layout.layoutInput.maxLines ==
                        1
                    ) {
                        intrinsics.maxIntrinsicWidth
                    } else {
                        intrinsics.minIntrinsicWidth
                    }
                layout.layoutInput.text.text
                    .takeIf { node.size.width < ceil(needs) }
            }
        assertEquals(emptyList<String>(), cut)
    }

    /** A photo, a link and two devices: every row of buttons Ég has. */
    private val everyButton =
        MeViewModel.State(
            me =
                Me(
                    "a1",
                    "Jón Jónsson",
                    true,
                    listOf(
                        AccountDevice("d1", Platform.ANDROID, 1_700_000_000_000u, current = true),
                        AccountDevice("d2", Platform.IOS, 1_700_000_100_000u, current = false),
                    ),
                    "v1",
                ),
            link = "https://link.test/l/1",
        )

    @Test
    fun nobodyBlocked() {
        // The section alone, so the image shows the empty line without the screen around it.
        compose.setContent {
            SpjallTheme {
                Column(modifier = Modifier.background(Palette.bg).padding(16.dp)) {
                    Blocked(emptyList(), enabled = true, onUnblock = {})
                }
            }
        }
        compose.onRoot().captureRoboImage()
    }
}

private class NoMeActions : MeActions {
    override fun newLink() = Unit

    override fun share(link: String) = Unit

    override fun readMarkers(on: Boolean) = Unit

    override fun typing(on: Boolean) = Unit

    override fun unblock(account: String) = Unit

    override fun revoke(deviceId: String) = Unit

    override fun deleteAccount() = Unit

    override fun choosePhoto() = Unit

    override fun removePhoto() = Unit

    override fun retry() = Unit

    override fun verify() = Unit

    override fun notificationSettings() = Unit
}
