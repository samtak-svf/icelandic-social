package samtak.spjall.social

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import samtak.spjall.brand.R
import samtak.spjall.core.Author
import samtak.spjall.core.Community
import samtak.spjall.core.CommunityAudience
import samtak.spjall.core.ModerationState
import samtak.spjall.core.Post
import samtak.spjall.core.ReactionKind
import samtak.spjall.core.ReportReason
import samtak.spjall.ui.SpjallTheme

@RunWith(AndroidJUnit4::class)
class CommunitiesScreenTest {
    @get:Rule val compose = createComposeRule()

    private fun text(id: Int) = InstrumentationRegistry.getInstrumentation().targetContext.getString(id)

    private val nobody =
        object : CommunitiesActions {
            override fun open(communityId: String) = Unit

            override fun openPost(postId: String) = Unit

            override fun comment(postId: String) = Unit

            override fun sendToConversation(postId: String) = Unit

            override fun react(
                postId: String,
                kind: ReactionKind,
            ) = Unit

            override fun report(
                postId: String,
                reason: ReportReason,
                note: String,
            ) = Unit

            override fun selectTab(tab: CommunitiesTab) = Unit

            override fun pin(
                communityId: String,
                pinned: Boolean,
            ) = Unit

            override fun create() = Unit

            override fun search(text: String) = Unit

            override fun more() = Unit

            override fun moreFeed() = Unit

            override fun retry() = Unit
        }

    private fun community() =
        Community(
            communityId = "k1",
            name = "Kórinn",
            description = "",
            audience = CommunityAudience.OPEN,
            createdAt = 1_700_000_000_000uL,
            memberCount = 3uL,
            role = null,
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
        )

    private fun post() =
        Post(
            postId = "p1",
            communityId = "k1",
            author = Author("a2", "Anna", verified = true),
            body = "Æfing á fimmtudag",
            images = emptyList(),
            createdAt = 1_700_000_000_000uL,
            reactions = emptyList(),
            myReaction = null,
            commentCount = 0uL,
            state = ModerationState.VISIBLE,
            latestComment = null,
        )

    private fun show(state: CommunitiesViewModel.State) =
        compose.setContent { SpjallTheme { CommunitiesScreen(state, nobody) } }

    @Test
    fun theMineTabShowsTheFeedUnderTheListOnceThereIsACommunity() {
        show(CommunitiesViewModel.State(mine = listOf(community()), feed = listOf(post()), loaded = true))
        compose.onNodeWithText(text(R.string.communities_from_yours), ignoreCase = true).assertIsDisplayed()
        compose.onNodeWithText("Æfing á fimmtudag").assertIsDisplayed()
    }

    @Test
    fun theMineTabHasNoFeedHeadingWithoutACommunity() {
        show(CommunitiesViewModel.State(feed = listOf(post()), loaded = true))
        compose.onAllNodesWithText(text(R.string.communities_from_yours), ignoreCase = true).assertCountEquals(0)
    }
}
