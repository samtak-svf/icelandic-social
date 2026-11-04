package samtak.spjall.social

import android.content.Context
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import samtak.spjall.brand.R
import samtak.spjall.conversations.SCREENSHOT_DEVICE
import samtak.spjall.conversations.SCREENSHOT_SDK
import samtak.spjall.core.CommunityAudience
import samtak.spjall.core.CommunityRole
import samtak.spjall.core.InvitedBy
import samtak.spjall.frames.FakeFrameRules
import samtak.spjall.frames.LocalFrameRules
import samtak.spjall.ui.SpjallTheme

/** An invitation to a community (decision 0130): the answer the invited person is asked for, and what each gives. */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [SCREENSHOT_SDK], qualifiers = SCREENSHOT_DEVICE, fontScale = 1f)
class CommunityInvitedTest {
    @get:Rule val compose = createComposeRule()

    private val dispatcher = StandardTestDispatcher()
    private val social = FakeSocial()
    private val calls = mutableListOf<String>()

    @Before fun main() = Dispatchers.setMain(dispatcher)

    @After fun reset() = Dispatchers.resetMain()

    private fun text(id: Int) = ApplicationProvider.getApplicationContext<Context>().getString(id)

    private fun text(
        id: Int,
        arg: String,
    ) = ApplicationProvider.getApplicationContext<Context>().getString(id, arg)

    private fun TestScope.model() = CommunityViewModel("k1", social, io = dispatcher).also { advanceUntilIdle() }

    private fun show(
        inviter: InvitedBy?,
        role: CommunityRole? = null,
    ) = compose.setContent {
        val actions = remember { recording<CommunityActions>(calls) }
        val community =
            community("k1", audience = CommunityAudience.PRIVATE, role = role, invitedBy = inviter, invited = true)
        val state = CommunityViewModel.State(community = community, loaded = true)
        CompositionLocalProvider(LocalFrameRules provides FakeFrameRules) {
            SpjallTheme { CommunityScreen(state, actions) }
        }
    }

    @Test
    fun theInvitedPersonSeesWhoInvitedThemAndTheTwoAnswers() {
        show(InvitedBy("a2", "Anna"))
        compose.onNodeWithText(text(R.string.community_invited_by, "Anna")).assertExists()
        compose.onNodeWithText(text(R.string.community_accept_invite)).performClick()
        compose.onNodeWithText(text(R.string.community_decline_invite)).performClick()
        assertEquals(listOf("join", "withdraw"), calls)
    }

    @Test
    fun noRequestToJoinIsOfferedBesideAnInvitation() {
        show(InvitedBy("a2", "Anna"))
        compose.onAllNodesWithText(text(R.string.community_request_join)).assertCountEquals(0)
        compose.onAllNodesWithText(text(R.string.community_join)).assertCountEquals(0)
    }

    @Test
    fun anInviterWhoseAccountWasDeletedReadsAsDeleted() {
        show(InvitedBy("a2", null))
        compose.onNodeWithText(text(R.string.community_invited_by, text(R.string.person_deleted))).assertExists()
    }

    @Test
    fun anInvitationFromBeforeInvitersWereKeptSaysOnlyThatTheyWereInvited() {
        show(null)
        compose.onNodeWithText(text(R.string.community_invited)).assertExists()
        compose.onNodeWithText(text(R.string.community_accept_invite)).assertExists()
    }

    @Test
    fun aMemberIsNotAskedToAnswer() {
        show(InvitedBy("a2", "Anna"), role = CommunityRole.MEMBER)
        compose.onAllNodesWithText(text(R.string.community_accept_invite)).assertCountEquals(0)
    }

    @Test
    fun acceptingJoinsAtOnceAndReloadsTheCommunity() =
        runTest(dispatcher) {
            social.communities["k1"] =
                community("k1", audience = CommunityAudience.PRIVATE, invitedBy = InvitedBy("a2", "Anna"))
            val model = model()
            val before = model.state.value.community!!
            assertTrue(before.invited)
            model.join()
            advanceUntilIdle()
            assertTrue("joinCommunity k1" in social.calls)
            val community = model.state.value.community!!
            assertEquals(CommunityRole.MEMBER, community.role)
            assertFalse(community.invited)
            assertFalse(community.joinRequested)
            assertNull(community.invitedBy)
        }

    @Test
    fun decliningTakesTheInvitationAwayAndAsksForNothingInItsPlace() =
        runTest(dispatcher) {
            social.communities["k1"] =
                community("k1", audience = CommunityAudience.PRIVATE, invitedBy = InvitedBy("a2", "Anna"))
            val model = model()
            model.withdraw()
            advanceUntilIdle()
            assertTrue("withdrawJoinRequest k1" in social.calls)
            assertFalse("joinCommunity k1" in social.calls)
            val community = model.state.value.community!!
            assertFalse(community.invited)
            assertNull(community.role)
            assertFalse(community.joinRequested)
        }
}
