package samtak.spjall.social

import android.content.Context
import android.os.Looper
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onLast
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import samtak.spjall.brand.R
import samtak.spjall.conversations.SCREENSHOT_DEVICE
import samtak.spjall.conversations.SCREENSHOT_SDK
import samtak.spjall.core.Relation
import samtak.spjall.core.WallAudience
import samtak.spjall.frames.FakeFrameRules
import samtak.spjall.frames.LocalFrameRules
import samtak.spjall.ui.LocalSuspension
import samtak.spjall.ui.SpjallTheme
import samtak.spjall.ui.Suspension

/** What the wall's controls call on the screen's actions, and what a suspension switches off (0115). */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [SCREENSHOT_SDK], qualifiers = SCREENSHOT_DEVICE)
class WallActionsTest {
    @get:Rule val compose = createComposeRule()

    private class Recorder : PersonActions {
        val calls = mutableListOf<String>()

        override fun back() = Unit

        override fun retry() = Unit

        override fun open(accountId: String) = Unit

        override fun openCommunity(communityId: String) = Unit

        override fun add() = Unit

        override fun cancel() = Unit

        override fun accept() = Unit

        override fun decline() = Unit

        override fun end() = Unit

        override fun snooze() = Unit

        override fun unsnooze() = Unit

        override fun settings() {
            calls += "settings"
        }

        override fun blocked() {
            calls += "blocked"
        }

        override fun chooseCover() {
            calls += "chooseCover"
        }

        override fun addImage() {
            calls += "addImage"
        }

        override fun togglePoll() {
            calls += "togglePoll"
        }

        override fun openPost(postId: String) {
            calls += "openPost $postId"
        }

        override fun report(
            target: samtak.spjall.core.ReportTarget,
            reason: samtak.spjall.core.ReportReason,
            note: String,
        ) {
            calls += "report ${target.kind} ${target.id}"
        }
    }

    private val since = 1_700_000_000_000uL

    private fun state(
        who: samtak.spjall.core.Author,
        relation: Relation,
    ) = PersonViewModel.State(
        profile = profile(who, relation, friendsSince = since),
        wall = wallOf(who.accountId, "Ég hlusta á kórinn.", null),
        posts =
            listOf(
                post("w1", author = who, body = "Fyrsta")
                    .copy(wallOwner = who.accountId, audience = WallAudience.FRIENDS),
            ),
        loaded = true,
    )

    private fun show(
        state: PersonViewModel.State,
        actions: PersonActions,
        suspended: Boolean = false,
    ) = compose.setContent {
        val suspension = if (suspended) Suspension(null) else null
        CompositionLocalProvider(LocalFrameRules provides FakeFrameRules, LocalSuspension provides suspension) {
            SpjallTheme { PersonScreen(state, actions, tab = true) }
        }
    }

    /** The clock is manual here, so a popup or a dialog gets its frames one at a time. */
    private fun settle() =
        repeat(40) {
            compose.mainClock.advanceTimeByFrame()
            shadowOf(Looper.getMainLooper()).idle()
        }

    private fun str(id: Int) = ApplicationProvider.getApplicationContext<Context>().getString(id)

    private fun reach(tag: String) = compose.onNodeWithTag("person").performScrollToNode(hasTestTag(tag))

    @Test
    fun theGearOpensTheSettings() {
        val rec = Recorder()
        show(state(self, Relation.ONESELF), rec)
        compose.onNodeWithTag("gear").performClick()
        assertEquals(listOf("settings"), rec.calls)
    }

    @Test
    fun theCameraOnTheCoverChoosesACoverAndOneOnThePictureOpensTheSettings() {
        val rec = Recorder()
        show(state(self, Relation.ONESELF), rec)
        compose.onNodeWithTag("cover-camera").performClick()
        compose.onNodeWithTag("avatar-camera").performClick()
        assertEquals(listOf("chooseCover", "settings"), rec.calls)
    }

    @Test
    fun theComposerAddsAnImageAndStartsAPoll() {
        val rec = Recorder()
        show(state(self, Relation.ONESELF), rec)
        reach("add-image")
        compose.onNodeWithTag("add-image").performClick()
        compose.onNodeWithTag("poll-toggle").performClick()
        assertEquals(listOf("addImage", "togglePoll"), rec.calls)
    }

    @Test
    fun aSuspensionSwitchesOffTheComposerTheAudienceAndTheCameras() {
        show(state(self, Relation.ONESELF), Recorder(), suspended = true)
        compose.onAllNodesWithTag("cover-camera").assertCountEquals(0)
        compose.onAllNodesWithTag("avatar-camera").assertCountEquals(0)
        reach("add-image")
        compose.onNodeWithTag("add-image").assertIsNotEnabled()
        compose.onNodeWithTag("poll-toggle").assertIsNotEnabled()
        compose.onAllNodesWithTag("audience-w1").assertCountEquals(0)
    }

    @Test
    fun aBlockedAccountLeavesTheScreenForTheFriendsList() {
        val rec = Recorder()
        show(state(anna, Relation.FRIENDS).copy(blocked = true), rec)
        compose.waitForIdle()
        assertEquals(listOf("blocked"), rec.calls)
    }

    @Test
    fun reportOnAWallPostCardReportsInPlaceAndDoesNotOpenThePost() {
        val rec = Recorder()
        show(state(anna, Relation.FRIENDS), rec)
        compose.onAllNodesWithContentDescription(str(R.string.more_options)).onLast().performClick()
        compose.waitForIdle()
        // The dialog's field blinks a cursor, so the clock never idles after this: step it by hand.
        compose.mainClock.autoAdvance = false
        compose.onNodeWithText(str(R.string.report)).performClick()
        settle()
        compose.onNodeWithText(str(R.string.report_title)).assertExists()
        assertTrue(rec.calls.none { it.startsWith("openPost") })
    }
}
