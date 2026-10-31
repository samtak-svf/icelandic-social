package samtak.spjall.social

import android.content.Context
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.test.core.app.ApplicationProvider
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import samtak.spjall.brand.R
import samtak.spjall.conversations.SCREENSHOT_DEVICE
import samtak.spjall.conversations.SCREENSHOT_SDK
import samtak.spjall.core.PostTarget
import samtak.spjall.frames.FakeFrameRules
import samtak.spjall.frames.LocalFrameRules
import samtak.spjall.ui.SpjallTheme

/** The feed tab (decision 0116): the list, the empty feed and the composer sheet for the wall and for a community. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [SCREENSHOT_SDK], qualifiers = SCREENSHOT_DEVICE, fontScale = 1f)
class FeedScreenshotTest {
    @get:Rule val compose = createComposeRule()

    private fun show(state: FeedViewModel.State) =
        compose.setContent {
            val actions = remember { recording<FeedActions>(mutableListOf()) }
            CompositionLocalProvider(LocalFrameRules provides FakeFrameRules) {
                SpjallTheme { FeedScreen(state, Attached(), actions) }
            }
        }

    private fun listState() =
        feedState(
            listOf(
                post("p1", body = "Kórinn æfir á þriðjudögum."),
                post("p2", body = "Hvað eigum við að syngja?", poll = feedPoll()),
            ),
            mine = listOf(memberOf("k1")),
        )

    private fun composerFrames() {
        // The sheet slides in; its window needs its frames one at a time.
        repeat(40) { compose.mainClock.advanceTimeByFrame() }
        compose.waitForIdle()
    }

    @Test
    fun list() {
        show(listState())
        compose.onRoot().captureRoboImage()
    }

    @Test
    fun empty() {
        show(feedState())
        compose.onRoot().captureRoboImage()
    }

    @Test
    fun composerForTheWall() {
        show(listState().copy(composing = true))
        composerFrames()
        compose.onNodeWithTag(FEED_COMPOSER).captureRoboImage()
    }

    @Test
    fun composerForACommunity() {
        val k1 = memberOf("k1", anonymousPosts = true)
        show(feedState(mine = listOf(k1), target = PostTarget.Community("k1", anonymous = false), composing = true))
        composerFrames()
        compose.onNodeWithTag(FEED_COMPOSER).captureRoboImage()
    }

    @Test
    fun anAnonymousCardAsAReaderSeesIt() {
        // Another reader's anonymous post: no author reaches the card, so the byline stands in (decision 0091).
        val anonymous = post("p1", body = "Hver mætir á fundinn?", author = null, anonymous = true, own = false)
        show(feedState(listOf(anonymous), mine = listOf(memberOf("k1", anonymousPosts = true))))
        // The card is on the page before the picture is taken, so an empty feed cannot pass for it.
        compose.onNodeWithText("Hver mætir á fundinn?").assertIsDisplayed()
        val byline = ApplicationProvider.getApplicationContext<Context>().getString(R.string.post_anonymous_author)
        compose.onNodeWithText(byline, substring = true).assertIsDisplayed()
        compose.onRoot().captureRoboImage()
    }
}
