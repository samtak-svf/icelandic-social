package samtak.spjall.social

import android.content.Context
import android.os.Looper
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onLast
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
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
import samtak.spjall.core.CommunityRole
import samtak.spjall.core.PostTarget
import samtak.spjall.frames.FakeFrameRules
import samtak.spjall.frames.LocalFrameRules
import samtak.spjall.ui.SpjallTheme

/** The feed tab (decision 0116): what its cards may do, and the composer that opens from the prompt. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [SCREENSHOT_SDK], qualifiers = SCREENSHOT_DEVICE, fontScale = 1f)
class FeedScreenTest {
    @get:Rule val compose = createComposeRule()

    private val calls = mutableListOf<String>()

    private fun show(
        state: FeedViewModel.State,
        attached: Attached = Attached(),
    ) = compose.setContent {
        val actions = remember { recording<FeedActions>(calls) }
        CompositionLocalProvider(LocalFrameRules provides FakeFrameRules) {
            SpjallTheme { FeedScreen(state, attached, actions) }
        }
    }

    private fun text(id: Int) = ApplicationProvider.getApplicationContext<Context>().getString(id)

    private fun settle() =
        repeat(40) {
            compose.mainClock.advanceTimeByFrame()
            shadowOf(Looper.getMainLooper()).idle()
        }

    private fun pollPost(id: String = "p1") = post(id, communityId = "k1", poll = feedPoll())

    @Test
    fun anOpenPollInAnUnmutedCommunityTakesAVote() {
        show(feedState(listOf(pollPost()), mine = listOf(memberOf("k1"))))
        compose.onNodeWithTag("$POLL_OPTION-0").assertIsEnabled().performClick()
        assertEquals(listOf("vote p1 o0"), calls)
    }

    @Test
    fun aMutedCommunitysPollHasNoVoteToGive() {
        show(feedState(listOf(pollPost()), mine = listOf(memberOf("k1", mutedUntil = MUTED_FOR_GOOD))))
        compose.onNodeWithTag("$POLL_OPTION-0").assertIsNotEnabled().performClick()
        compose.onNodeWithTag("$POLL_OPTION-1").assertIsNotEnabled().performClick()
        assertEquals(emptyList<String>(), calls)
    }

    @Test
    fun aMutedCommunitysPollCannotBeClosedEitherByItsModerator() {
        val mine = listOf(memberOf("k1", mutedUntil = MUTED_FOR_GOOD, role = CommunityRole.MODERATOR))
        show(feedState(listOf(pollPost()), mine = mine))
        compose.onAllNodesWithTag(POLL_CLOSE).assertCountEquals(0)
    }

    @Test
    fun aModeratorClosesAnOpenPollAndAMemberCannot() {
        show(feedState(listOf(pollPost()), mine = listOf(memberOf("k1", role = CommunityRole.MODERATOR))))
        compose.onNodeWithTag(POLL_CLOSE).performClick()
        assertEquals(listOf("closePoll p1"), calls)
    }

    @Test
    fun aMemberIsNotOfferedToClose() {
        show(feedState(listOf(pollPost()), mine = listOf(memberOf("k1"))))
        compose.onAllNodesWithTag(POLL_CLOSE).assertCountEquals(0)
    }

    @Test
    fun aWallPostIsNotSentToAConversation() {
        val wallPost = post("w1", author = anna).copy(wallOwner = self.accountId)
        show(feedState(listOf(wallPost)))
        compose.onNodeWithText(text(R.string.share)).performClick()
        compose.onNodeWithText(text(R.string.post_copy_link)).assertExists()
        compose.onAllNodesWithText(text(R.string.post_share_to_conversation)).assertCountEquals(0)
    }

    @Test
    fun aCommunityPostCanBeSentToAConversation() {
        show(feedState(listOf(post("p1", communityId = "k1")), mine = listOf(memberOf("k1"))))
        compose.onNodeWithText(text(R.string.share)).performClick()
        compose.onNodeWithText(text(R.string.post_share_to_conversation)).performClick()
        assertEquals(listOf("sendToConversation p1"), calls)
    }

    @Test
    fun thePromptAsksForTheComposerAndNothingOpensUntilTheStateSaysSo() {
        show(feedState())
        compose.onNodeWithTag(FEED_COMPOSE_PROMPT).performClick()
        settle()
        assertEquals(listOf("openComposer"), calls)
        compose.onAllNodesWithTag(FEED_COMPOSER).assertCountEquals(0)
    }

    @Test
    fun theComposerOnTheWallHasItsAudienceAndNoAnonymousSwitch() {
        show(feedState(mine = listOf(memberOf("k1", anonymousPosts = true)), composing = true))
        settle()
        compose.onNodeWithTag(FEED_COMPOSER).assertExists()
        compose.onNodeWithText(text(R.string.wall_not_encrypted_notice)).assertExists()
        compose.onAllNodesWithTag(FEED_ANONYMOUS).assertCountEquals(0)
    }

    @Test
    fun aCommunityThatAllowsItOffersTheAnonymousSwitchAndNoAudience() {
        val k1 = memberOf("k1", anonymousPosts = true)
        show(feedState(mine = listOf(k1), target = PostTarget.Community("k1", anonymous = false), composing = true))
        settle()
        compose.onNodeWithTag(FEED_ANONYMOUS).assertExists()
        compose.onAllNodesWithText(text(R.string.wall_not_encrypted_notice)).assertCountEquals(0)
    }

    @Test
    fun theTargetRowNamesTheCommunityAndPicksFromTheOfferedOnes() {
        show(feedState(mine = listOf(memberOf("k1")), composing = true))
        settle()
        compose.onNodeWithTag(FEED_TARGET).performClick()
        settle()
        compose.onNodeWithTag("feed-target-k1").performClick()
        assertEquals(listOf("target Community(communityId=k1, anonymous=false)"), calls)
    }

    @Test
    fun aRefusalShowsInsideTheSheetWithItsRetry() {
        show(feedState(composing = true).copy(problem = Problem.Generic()))
        settle()
        // Once in the list behind the sheet and once in the sheet, which is the one above the scrim.
        val tryAgain = compose.onAllNodesWithText(text(R.string.try_again))
        tryAgain.assertCountEquals(2)
        tryAgain.onLast().performClick()
        assertEquals(listOf("retry"), calls)
    }
}
