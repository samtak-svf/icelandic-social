package samtak.spjall.social

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import samtak.spjall.account.problem
import samtak.spjall.brand.R
import samtak.spjall.core.Author
import samtak.spjall.core.Community
import samtak.spjall.core.CommunityAudience
import samtak.spjall.core.CommunityRole
import samtak.spjall.core.CoreException
import samtak.spjall.core.ModerationState
import samtak.spjall.core.Poll
import samtak.spjall.core.PollOption
import samtak.spjall.core.Post
import samtak.spjall.ui.ProblemCard
import samtak.spjall.ui.SpjallTheme

/** The community tabs (0089), polls (0090) and the featured strip (0088), driven with fake state and callbacks. */
@RunWith(AndroidJUnit4::class)
class CommunityUiTest {
    @get:Rule val compose = createComposeRule()

    private fun text(id: Int) = InstrumentationRegistry.getInstrumentation().targetContext.getString(id)

    private fun post(
        id: String,
        body: String = "Body $id",
    ) = Post(
        postId = id,
        communityId = "k1",
        author = Author("a1", "Anna", verified = true),
        body = body,
        images = emptyList(),
        createdAt = 1_700_000_000_000uL,
        reactions = emptyList(),
        myReaction = null,
        commentCount = 0uL,
        state = ModerationState.VISIBLE,
        latestComment = null,
    )

    private fun poll(
        mine: String? = null,
        closed: Boolean = false,
    ) = Poll(listOf(PollOption("o0", "First", 1uL), PollOption("o1", "Second", 2uL)), 3uL, mine, closed)

    private fun community(featured: List<Post>) =
        Community(
            communityId = "k1",
            name = "Community",
            description = "",
            audience = CommunityAudience.OPEN,
            createdAt = 1_700_000_000_000uL,
            memberCount = 3uL,
            role = CommunityRole.MEMBER,
            joinRequested = false,
            invited = false,
            mutedUntil = null,
            readOnly = false,
            deletedAt = null,
            joinDeclinedUntil = null,
            pendingJoinRequests = null,
            unread = 0uL,
            pinned = false,
            lastPostAt = null,
            anonymousPosts = false,
            pendingAnonymous = 0uL,
        ).copy(featured = featured)

    // Tabs

    private fun showTabs(
        featured: List<Post>,
        chosen: MutableList<CommunityTab>,
    ) = compose.setContent {
        SpjallTheme {
            var state by remember { mutableStateOf(CommunityViewModel.State(community = community(featured))) }
            CommunityTabRow(state.visibleTabs(), state.shownTab()) {
                chosen += it
                state = state.copy(tab = it)
            }
        }
    }

    @Test
    fun tappingATabCallsBackWithItAndSelectsIt() {
        val chosen = mutableListOf<CommunityTab>()
        showTabs(listOf(post("p1")), chosen)
        compose.onNodeWithTag("$COMMUNITY_TABS-${CommunityTab.DISCUSSION.name}").assertIsSelected()
        compose.onNodeWithTag("$COMMUNITY_TABS-${CommunityTab.MEMBERS.name}").performClick()
        assertEquals(listOf(CommunityTab.MEMBERS), chosen)
        compose.onNodeWithTag("$COMMUNITY_TABS-${CommunityTab.MEMBERS.name}").assertIsSelected()
    }

    @Test
    fun theFeaturedTabIsShownOnlyWhileAPostIsFeatured() {
        showTabs(emptyList(), mutableListOf())
        compose.onNodeWithTag("$COMMUNITY_TABS-${CommunityTab.FEATURED.name}").assertDoesNotExist()
        compose.onNodeWithText(text(R.string.community_tab_featured)).assertDoesNotExist()
    }

    @Test
    fun theFeaturedTabIsShownWhenAPostIsFeatured() {
        showTabs(listOf(post("p1")), mutableListOf())
        compose.onNodeWithTag("$COMMUNITY_TABS-${CommunityTab.FEATURED.name}").assertIsDisplayed()
    }

    // Polls

    /** The feed is a lazy list, which gives a card unbounded height; a bounded one would stretch each option's bar. */
    @Composable
    private fun InFeed(content: @Composable () -> Unit) =
        Column(Modifier.verticalScroll(rememberScrollState())) {
            content()
        }

    private fun showPoll(
        poll: Poll,
        voted: MutableList<String>,
        calls: MutableList<String> = mutableListOf(),
        closable: Boolean = true,
    ) = compose.setContent {
        SpjallTheme {
            InFeed {
                PollCard(
                    poll = poll,
                    busy = false,
                    callbacks =
                        PollCallbacks(
                            onVote = { voted += it },
                            onWithdraw = { calls += "withdraw" },
                            onClose = if (closable) ({ calls += "close" }) else null,
                        ),
                )
            }
        }
    }

    @Test
    fun tappingAnOptionVotesForIt() {
        val voted = mutableListOf<String>()
        showPoll(poll(), voted)
        compose.onNodeWithTag("$POLL_OPTION-1").performClick()
        assertEquals(listOf("o1"), voted)
    }

    @Test
    fun withAVoteRecordedTappingAnotherOptionChangesIt() {
        val voted = mutableListOf<String>()
        compose.setContent {
            SpjallTheme {
                var mine by remember { mutableStateOf<String?>("o0") }
                InFeed {
                    PollCard(
                        poll = poll(mine = mine),
                        busy = false,
                        callbacks =
                            PollCallbacks(
                                onVote = {
                                    voted += it
                                    mine = it
                                },
                                onWithdraw = {},
                                onClose = null,
                            ),
                    )
                }
            }
        }
        compose.onNodeWithTag("$POLL_OPTION-0").assertIsSelected()
        // The chosen option is not a target; the other one is.
        compose.onNodeWithTag("$POLL_OPTION-0").performClick()
        assertTrue(voted.isEmpty())
        compose.onNodeWithTag("$POLL_OPTION-1").performClick()
        assertEquals(listOf("o1"), voted)
        compose.onNodeWithTag("$POLL_OPTION-1").assertIsSelected()
    }

    @Test
    fun withdrawAndCloseCallTheirCallbacksWhenShown() {
        val calls = mutableListOf<String>()
        showPoll(poll(mine = "o0"), mutableListOf(), calls)
        compose.onNodeWithTag(POLL_WITHDRAW).performClick()
        compose.onNodeWithTag(POLL_CLOSE).performClick()
        assertEquals(listOf("withdraw", "close"), calls)
    }

    @Test
    fun withdrawNeedsAVoteAndCloseNeedsTheRightToClose() {
        showPoll(poll(), mutableListOf(), closable = false)
        compose.onNodeWithTag(POLL_WITHDRAW).assertDoesNotExist()
        compose.onNodeWithTag(POLL_CLOSE).assertDoesNotExist()
    }

    // The featured strip

    @Test
    fun theStripShowsTheCardsInTheOrderGivenAndOpensOne() {
        val opened = mutableListOf<String>()
        val posts = listOf(post("p3", "Third"), post("p1", "First"), post("p2", "Second"))
        compose.setContent { SpjallTheme { FeaturedStrip(posts) { opened += it } } }
        val xs =
            posts.map {
                val node = compose.onNodeWithText(it.body).fetchSemanticsNode()
                node.positionInRoot.x
            }
        assertTrue("cards are not left to right in the given order: $xs", xs == xs.sorted() && xs.distinct().size == 3)
        compose.onNodeWithText("Third").performClick()
        assertEquals(listOf("p3"), opened)
    }

    @Test
    fun aPinLimitRefusalShowsTheThreePostLimitMessage() {
        val problem = CoreException.Refused(403u, "pin_limit", "req-1").problem()
        compose.setContent { SpjallTheme { ProblemCard(problem, onRetry = {}) } }
        compose.onNodeWithText(text(R.string.post_pin_full)).assertIsDisplayed()
    }
}
