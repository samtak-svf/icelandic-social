package samtak.spjall.conversation

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import samtak.spjall.brand.R
import samtak.spjall.conversations.SCREENSHOT_DEVICE
import samtak.spjall.conversations.SCREENSHOT_SDK
import samtak.spjall.core.Conversation
import samtak.spjall.core.ConversationState
import samtak.spjall.core.Mute
import samtak.spjall.core.Person
import samtak.spjall.ui.BELL
import samtak.spjall.ui.Bell
import samtak.spjall.ui.LocalBell

/**
 * The bell with its count in the top bar of an open conversation (decision 0111): the screen a reader spends most
 * time in, and the one that drew none under 0109. A screen the shell gives no bell draws none. Rewrite the images
 * with `./gradlew recordRoborazziDebug` when a change is meant.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [SCREENSHOT_SDK], qualifiers = SCREENSHOT_DEVICE, fontScale = 1f)
class ConversationBellScreenshotTest {
    @get:Rule val compose = createComposeRule()

    private var rang = 0

    private val state =
        ConversationViewModel.State(
            conversation =
                Conversation(
                    id = "c1",
                    state = ConversationState.ACTIVE,
                    members = listOf(Person("a2", "Anna Jónsdóttir", true)),
                    last = null,
                    unread = 0u,
                    timer = 3_600u,
                    mute = Mute.Off,
                ),
            loaded = true,
        )

    private fun show(withBell: Boolean) {
        val bell =
            if (withBell) {
                Bell(RuntimeEnvironment.getApplication().getString(R.string.notifications_title), 3, null, false) {
                    rang++
                }
            } else {
                null
            }
        compose.setContent {
            DecodingTheme { CompositionLocalProvider(LocalBell provides bell) { TopBar(state, IdleActions) } }
        }
    }

    @Test
    fun theTopBarEndsWithTheBell() {
        show(withBell = true)
        compose.onNodeWithTag(BELL).assertIsDisplayed()
        compose.onRoot().captureRoboImage()
    }

    @Test
    @Config(qualifiers = "+night")
    fun theTopBarEndsWithTheBellAtNight() {
        show(withBell = true)
        compose.onNodeWithTag(BELL).assertIsDisplayed()
        compose.onRoot().captureRoboImage()
    }

    @Test
    fun theBellOpensTheNotifications() {
        show(withBell = true)
        compose.onNodeWithTag(BELL).performClick()
        assertEquals(1, rang)
    }

    @Test
    fun withoutTheShellsBellTheTopBarDrawsNone() {
        show(withBell = false)
        compose.onNodeWithTag(BELL).assertDoesNotExist()
    }
}
