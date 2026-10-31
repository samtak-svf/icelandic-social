package samtak.spjall.social

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertTrue
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
import samtak.spjall.core.Poll
import samtak.spjall.core.PollOption
import samtak.spjall.ui.SpjallTheme

/**
 * The count under a poll keeps its line when the reader may both withdraw and close. It shared a row with the two
 * actions and got only the width they left, which set "1 atkvæði" a letter or two to the line on a phone.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [SCREENSHOT_SDK], qualifiers = SCREENSHOT_DEVICE, fontScale = 1f)
class PollFooterTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun theCountKeepsItsLineBesideBothActions() {
        val poll = Poll(listOf(PollOption("o1", "Ísbók", 1uL), PollOption("o2", "Bókin", 0uL)), 1uL, "o1", false)
        var line = 0.dp
        compose.setContent {
            SpjallTheme {
                val style = MaterialTheme.typography.bodyMedium
                line = with(LocalDensity.current) { style.lineHeight.toDp() }
                // As in the feed, where a card's height is unbounded and its bars do not fill the screen.
                Column(Modifier.width(CARD_WIDTH.dp).verticalScroll(rememberScrollState())) {
                    PollCard(poll, busy = false, callbacks = PollCallbacks({}, {}, {}))
                }
            }
        }
        val count =
            RuntimeEnvironment
                .getApplication()
                .resources
                .getQuantityString(R.plurals.poll_votes, 1, 1)
        val bounds = compose.onNodeWithText(count).getUnclippedBoundsInRoot()
        val height = bounds.bottom - bounds.top
        assertTrue("$height against a line of $line", height <= line * ONE_LINE)
        compose.onNodeWithTag(POLL_WITHDRAW).assertIsDisplayed()
        compose.onNodeWithTag(POLL_CLOSE).assertIsDisplayed()
    }

    private companion object {
        /** The inside of a card on a phone 360 dp wide. */
        const val CARD_WIDTH = 312

        /** Taller than one line of the count and shorter than two. */
        const val ONE_LINE = 1.5f
    }
}
