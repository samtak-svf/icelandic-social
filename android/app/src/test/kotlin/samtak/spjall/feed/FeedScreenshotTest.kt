package samtak.spjall.feed

import android.content.Context
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasScrollToIndexAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToIndex
import androidx.test.core.app.ApplicationProvider
import com.github.takahirom.roborazzi.captureRoboImage
import com.github.takahirom.roborazzi.captureScreenRoboImage
import kotlinx.coroutines.flow.emptyFlow
import org.junit.After
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
import samtak.spjall.core.Person
import samtak.spjall.core.Post
import samtak.spjall.core.ReactionCounts
import samtak.spjall.ui.SpjallTheme
import java.util.TimeZone

/**
 * Fljótið, a wall and the replies as decision 0043 draws them: the short public line and its
 * sheet, the pill for newer posts, and the one empty state. See ConversationsScreenshotTest.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [SCREENSHOT_SDK], qualifiers = SCREENSHOT_DEVICE, fontScale = 1f)
class FeedScreenshotTest {
    @get:Rule val compose = createComposeRule()

    private val actions = NoPostsActions()
    private val anna = Person("a2", "Anna Jónsdóttir", true)

    private val savedZone = TimeZone.getDefault()

    @Before
    fun fixZone() = TimeZone.setDefault(TimeZone.getTimeZone("Atlantic/Reykjavik"))

    @After
    fun restoreZone() = TimeZone.setDefault(savedZone)

    private fun text(id: Int) = ApplicationProvider.getApplicationContext<Context>().getString(id)

    private fun post(id: String) = Post(id, anna, "Halló frá $id", PAST, 0u, ReactionCounts(0u, 0u, 0u, 0u, 0u), null)

    private fun feed(
        posts: List<Post> = emptyList(),
        newer: Boolean = false,
    ) {
        val state = PostsViewModel.State(posts = posts, loaded = true, me = "a1", newer = newer)
        compose.setContent { SpjallTheme { FeedScreen(state, actions, emptyFlow()) } }
    }

    @Test
    fun empty() {
        feed()
        compose.onRoot().captureRoboImage()
    }

    @Test
    fun publicNoticeSheet() {
        feed()
        compose.onNodeWithContentDescription(text(R.string.feed_public_more)).performClick()
        compose.waitForIdle()
        compose.onNodeWithText(text(R.string.feed_public_notice)).assertIsDisplayed()
        // The sheet is a window of its own: the whole screen, both windows.
        captureScreenRoboImage()
    }

    @Test
    fun newerPostsPill() {
        feed((1..POSTS).map { post("p$it") }, newer = true)
        compose.onNode(hasScrollToIndexAction()).performScrollToIndex(POSTS)
        compose.onRoot().captureRoboImage()
    }

    @Test
    fun emptyWall() {
        compose.setContent {
            SpjallTheme {
                WallScreen(
                    PostsViewModel.State(loaded = true, me = "a1", person = anna),
                    actions,
                    onBack = {},
                    onContact = {},
                )
            }
        }
        compose.onRoot().captureRoboImage()
    }

    @Test
    fun noReplies() {
        compose.setContent {
            SpjallTheme {
                RepliesScreen(
                    RepliesViewModel.State(post = post("p1"), loaded = true, me = "a1"),
                    NoRepliesActions(),
                    emptyFlow(),
                )
            }
        }
        compose.onRoot().captureRoboImage()
    }

    private companion object {
        // 14 November 2023, 22:13 in Reykjavík.
        const val PAST = 1_700_000_000_000uL
        const val POSTS = 20
    }
}

private class NoPostsActions : PostsActions {
    override fun author(person: Person) = Unit

    override fun heart(post: Post) = Unit

    override fun replies(postId: String) = Unit

    override fun delete(postId: String) = Unit

    override fun share(postId: String) = Unit

    override fun post(body: String) = Unit

    override fun loadMore() = Unit

    override fun refresh() = Unit
}

private class NoRepliesActions : RepliesActions {
    override fun back() = Unit

    override fun author(person: Person) = Unit

    override fun heart() = Unit

    override fun deletePost() = Unit

    override fun share() = Unit

    override fun send(body: String) = Unit

    override fun delete(replyId: String) = Unit

    override fun loadMore() = Unit

    override fun retry() = Unit
}
