package samtak.spjall.social

import android.content.Context
import android.os.Looper
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isHeading
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
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
import samtak.spjall.account.Problem
import samtak.spjall.brand.R
import samtak.spjall.conversations.SCREENSHOT_DEVICE
import samtak.spjall.conversations.SCREENSHOT_SDK
import samtak.spjall.core.Relation
import samtak.spjall.core.WallAudience
import samtak.spjall.frames.FakeFrameRules
import samtak.spjall.frames.LocalFrameRules
import samtak.spjall.me.OwnWallPending
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

        override fun choosePhoto() {
            calls += "choosePhoto"
        }

        override fun reframePhoto() {
            calls += "reframePhoto"
        }

        override fun removePhoto() {
            calls += "removePhoto"
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
        photoProblem: Problem? = null,
    ) = compose.setContent {
        val suspension = if (suspended) Suspension(null) else null
        CompositionLocalProvider(LocalFrameRules provides FakeFrameRules, LocalSuspension provides suspension) {
            SpjallTheme { PersonScreen(state, actions, tab = true, photoProblem = photoProblem) }
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
    fun theOwnWallIsTitledAsOnesOwnAndItsCardAloneCarriesTheName() {
        val own = self.copy(name = "Una")
        show(state(own, Relation.ONESELF), Recorder())
        compose.onNode(isHeading() and hasText(str(R.string.wall_own_title), ignoreCase = true)).assertExists()
        compose.onAllNodes(isHeading() and hasText("Una", ignoreCase = true)).assertCountEquals(0)
        compose.onAllNodesWithText("Una", substring = true).onFirst().assertExists()
    }

    @Test
    fun anotherPersonsWallIsTitledWithTheirName() {
        show(state(anna, Relation.FRIENDS), Recorder())
        compose.onNode(isHeading() and hasText(anna.name!!, ignoreCase = true)).assertExists()
        compose.onAllNodesWithText(str(R.string.wall_own_title), ignoreCase = true).assertCountEquals(0)
    }

    @Test
    fun theGearOpensTheSettings() {
        val rec = Recorder()
        show(state(self, Relation.ONESELF), rec)
        compose.onNodeWithTag("gear").performClick()
        assertEquals(listOf("settings"), rec.calls)
    }

    @Test
    fun theCameraOnTheCoverChoosesACoverAndTheOneOnThePictureChoosesAPhoto() {
        val rec = Recorder()
        show(state(self, Relation.ONESELF), rec)
        compose.onNodeWithTag("cover-camera").performClick()
        compose.onNodeWithTag("avatar-camera").performClick()
        compose.onNodeWithTag("photo-choose").performClick()
        assertEquals(listOf("chooseCover", "choosePhoto"), rec.calls)
        compose.onAllNodesWithTag("photo-reframe").assertCountEquals(0)
        compose.onAllNodesWithTag("photo-remove").assertCountEquals(0)
    }

    @Test
    fun aPhotoCanBeFramedAgainOnTheOwnWall() {
        val rec = Recorder()
        show(withPhoto(), rec)
        compose.onNodeWithTag("avatar-camera").performClick()
        compose.onNodeWithTag("photo-reframe").performClick()
        assertEquals(listOf("reframePhoto"), rec.calls)
    }

    @Test
    fun removingThePhotoAsksFirst() {
        val rec = Recorder()
        show(withPhoto(), rec)
        compose.onNodeWithTag("avatar-camera").performClick()
        compose.onNodeWithTag("photo-remove").performClick()
        compose.onNodeWithText(str(R.string.photo_remove_confirm)).assertExists()
        assertEquals("nothing is removed on one tap", emptyList<String>(), rec.calls)
        compose.onAllNodesWithText(str(R.string.photo_remove)).onLast().performClick()
        assertEquals(listOf("removePhoto"), rec.calls)
    }

    @Test
    fun aFailedRemovalShowsOnTheWallAndItsRetryRemovesAgain() {
        val rec = Recorder()
        show(withPhoto(), rec, photoProblem = Problem.Generic())
        compose.onNodeWithText(str(R.string.try_again)).performClick()
        assertEquals(listOf("removePhoto"), rec.calls)
    }

    @Test
    fun theWallsOwnProblemComesBeforeThePhotos() {
        val rec = Recorder()
        show(withPhoto().copy(problem = Problem.Generic()), rec, photoProblem = Problem.Generic())
        compose.onAllNodesWithText(str(R.string.try_again)).assertCountEquals(1)
        compose.onNodeWithText(str(R.string.try_again)).performClick()
        assertEquals(emptyList<String>(), rec.calls)
    }

    @Test
    fun theOwnWallBeforeTheAccountLoadedOffersARetry() {
        var retried = 0
        compose.setContent {
            CompositionLocalProvider(LocalFrameRules provides FakeFrameRules) {
                SpjallTheme { OwnWallPending(Problem.Generic()) { retried++ } }
            }
        }
        compose.onNodeWithText(str(R.string.try_again)).performClick()
        assertEquals(1, retried)
    }

    private fun withPhoto() = state(self, Relation.ONESELF).let { it.copy(profile = it.profile?.copy(photo = "v1")) }

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
