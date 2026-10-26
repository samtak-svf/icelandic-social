package samtak.spjall.social

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import samtak.spjall.brand.R
import samtak.spjall.core.Author
import samtak.spjall.core.AuthorRole
import samtak.spjall.core.Comment
import samtak.spjall.core.ModerationState
import samtak.spjall.core.Post
import samtak.spjall.ui.SpjallTheme

@RunWith(AndroidJUnit4::class)
class PostCardTest {
    @get:Rule val compose = createComposeRule()

    private val reacted = mutableListOf<String>()

    private fun text(id: Int) = InstrumentationRegistry.getInstrumentation().targetContext.getString(id)

    private val moderator = Author("a2", "Anna", verified = true, role = AuthorRole.MODERATOR)

    private fun post(body: String = "Halló") =
        Post(
            postId = "p1",
            communityId = "k1",
            author = moderator,
            body = body,
            images = emptyList(),
            createdAt = 1_700_000_000_000uL,
            emojis = emptyList(),
            myEmoji = null,
            commentCount = 1uL,
            state = ModerationState.VISIBLE,
            latestComment =
                Comment(
                    commentId = "c1",
                    postId = "p1",
                    parentCommentId = null,
                    author = Author("a3", "Bjarni", verified = true),
                    body = "Sammála",
                    createdAt = 1_700_000_000_000uL,
                    state = ModerationState.VISIBLE,
                ),
        )

    private fun show(post: Post) =
        compose.setContent {
            SpjallTheme {
                PostCard(
                    post = post,
                    reacting = false,
                    reported = false,
                    callbacks =
                        PostCardCallbacks(
                            onReact = { reacted += it },
                            onReport = {},
                            onOpen = {},
                            onComment = {},
                        ),
                )
            }
        }

    @Test
    fun theCardShowsTheRoleBadgeTheThreeActionsAndTheLatestComment() {
        show(post())
        compose.onNodeWithText(text(R.string.community_role_moderator)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.post_like)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.post_comment_action)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.share)).assertIsDisplayed()
        compose.onNodeWithText("Sammála").assertIsDisplayed()
        compose.onNodeWithText(text(R.string.post_write_comment)).assertIsDisplayed()
    }

    @Test
    fun aLongBodyIsClampedWithSeeMore() {
        show(post(body = List(40) { "orð" }.joinToString("\n")))
        compose.onNodeWithText(text(R.string.post_see_more)).assertIsDisplayed()
    }

    @Test
    fun aLongPressOnLikeOffersTheQuickBarAndOneIsSent() {
        show(post())
        compose.onNodeWithText(text(R.string.post_like)).performTouchInput { longClick() }
        listOf(
            R.string.reaction_like,
            R.string.reaction_love,
            R.string.reaction_laugh,
            R.string.reaction_wow,
            R.string.reaction_sad,
            R.string.reaction_pray,
        ).forEach { compose.onNodeWithContentDescription(text(it)).assertIsDisplayed() }
        compose.onNodeWithContentDescription(text(R.string.reaction_love)).performClick()
        assertEquals(listOf("\u2764\uFE0F"), reacted)
    }
}
