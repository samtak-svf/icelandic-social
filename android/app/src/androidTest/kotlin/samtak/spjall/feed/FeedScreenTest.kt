package samtak.spjall.feed

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.flow.emptyFlow
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import samtak.spjall.brand.R
import samtak.spjall.core.Person
import samtak.spjall.core.Post
import samtak.spjall.core.PostReaction
import samtak.spjall.core.ReactionCounts
import samtak.spjall.ui.SpjallTheme

/** Fljótið: says it is public, writes a post, and acts on each post (decision 0034). */
@RunWith(AndroidJUnit4::class)
class FeedScreenTest {
    @get:Rule val compose = createComposeRule()

    private val calls = mutableListOf<String>()
    private val actions = RecordingPostsActions(calls)
    private val me = Person("a1", "Jón Jónsson", true)
    private val anna = Person("a2", "Anna Jónsdóttir", false)

    private fun text(id: Int) = InstrumentationRegistry.getInstrumentation().targetContext.getString(id)

    private fun post(
        id: String,
        author: Person,
        mine: PostReaction? = null,
    ) = Post(id, author, "Halló frá $id", 1_700_000_000_000u, 2u, ReactionCounts(3u, 0u, 0u, 0u, 0u), mine)

    private fun show(vararg posts: Post) {
        compose.setContent {
            SpjallTheme {
                FeedScreen(
                    PostsViewModel.State(posts = posts.toList(), loaded = true, me = "a1"),
                    actions,
                    emptyFlow(),
                )
            }
        }
    }

    @Test
    fun theFeedSaysItIsPublic() {
        show()
        compose.onNodeWithText(text(R.string.feed_public_notice)).assertExists()
        compose.onNodeWithText(text(R.string.feed_empty)).assertExists()
    }

    @Test
    fun thePillWritesAPost() {
        show()
        compose.onNodeWithText(text(R.string.feed_composer_placeholder)).performClick()
        compose.onNode(hasSetTextAction()).performTextInput("Góðan daginn")
        compose.onNodeWithText(text(R.string.post_action)).performClick()
        assertEquals(listOf("post Góðan daginn"), calls)
    }

    @Test
    fun theSheetOpensWithTheFieldFocused() {
        show()
        compose.onNodeWithText(text(R.string.feed_composer_placeholder)).performClick()
        compose.onNode(hasSetTextAction()).assertIsFocused()
    }

    @Test
    fun eachPostHasItsHeartRepliesAndAuthor() {
        show(post("p1", anna))
        compose.onNodeWithText("Halló frá p1").assertExists()
        compose.onNodeWithContentDescription("${text(R.string.post_react)}, 3").performClick()
        compose.onNodeWithContentDescription("${text(R.string.post_reply)}, 2").performClick()
        compose.onNodeWithText("Anna Jónsdóttir").performClick()
        assertEquals(listOf("heart p1", "replies p1", "author a2"), calls)
    }

    @Test
    fun onlyOwnPostsCanBeDeletedAndOnlyAfterAsking() {
        show(post("p1", anna), post("p2", me))
        compose.onAllNodesWithContentDescription(text(R.string.delete)).assertCountEquals(1)
        compose.onNodeWithContentDescription(text(R.string.delete)).performClick()
        compose.onNodeWithText(text(R.string.delete)).performClick()
        assertEquals(emptyList<String>(), calls)
        compose.onNodeWithText(text(R.string.post_delete_confirm)).assertExists()
        compose.onNodeWithText(text(R.string.delete)).performClick()
        assertEquals(listOf("delete p2"), calls)
    }
}

/** Records what a list of posts asks for, as "name argument". */
class RecordingPostsActions(
    private val calls: MutableList<String>,
) : PostsActions {
    override fun author(person: Person) {
        calls += "author ${person.account}"
    }

    override fun heart(post: Post) {
        calls += "heart ${post.postId}"
    }

    override fun replies(postId: String) {
        calls += "replies $postId"
    }

    override fun delete(postId: String) {
        calls += "delete $postId"
    }

    override fun post(body: String) {
        calls += "post $body"
    }

    override fun loadMore() {
        calls += "loadMore"
    }

    override fun refresh() {
        calls += "refresh"
    }
}
