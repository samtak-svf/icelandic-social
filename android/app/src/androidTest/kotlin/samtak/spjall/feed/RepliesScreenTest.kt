package samtak.spjall.feed

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
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
import samtak.spjall.core.ReactionCounts
import samtak.spjall.ui.SpjallTheme

/** The post on its replies screen can be sent into a conversation too (decision 0040). */
@RunWith(AndroidJUnit4::class)
class RepliesScreenTest {
    @get:Rule val compose = createComposeRule()

    private val calls = mutableListOf<String>()

    private fun text(id: Int) = InstrumentationRegistry.getInstrumentation().targetContext.getString(id)

    @Test
    fun thePostCanBeSentIntoAConversation() {
        val anna = Person("a2", "Anna Jónsdóttir", false)
        val post = Post("p1", anna, "Halló", 1_700_000_000_000u, 0u, ReactionCounts(0u, 0u, 0u, 0u, 0u), null)
        compose.setContent {
            SpjallTheme {
                RepliesScreen(
                    RepliesViewModel.State(post = post, loaded = true, me = "a1"),
                    RecordingRepliesActions(calls),
                    emptyFlow(),
                )
            }
        }
        compose.onNodeWithContentDescription(text(R.string.more_options)).performClick()
        compose.onNodeWithText(text(R.string.delete)).assertDoesNotExist()
        compose.onNodeWithText(text(R.string.share_post)).performClick()
        assertEquals(listOf("share"), calls)
    }
}

/** Records what the replies screen asks for, as "name argument". */
private class RecordingRepliesActions(
    private val calls: MutableList<String>,
) : RepliesActions {
    override fun back() {
        calls += "back"
    }

    override fun author(person: Person) {
        calls += "author ${person.account}"
    }

    override fun heart() {
        calls += "heart"
    }

    override fun deletePost() {
        calls += "deletePost"
    }

    override fun share() {
        calls += "share"
    }

    override fun send(body: String) {
        calls += "send $body"
    }

    override fun delete(replyId: String) {
        calls += "delete $replyId"
    }

    override fun loadMore() {
        calls += "loadMore"
    }

    override fun retry() {
        calls += "retry"
    }
}
