package samtak.spjall.social

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import samtak.spjall.brand.R
import samtak.spjall.core.Author
import samtak.spjall.core.Comment
import samtak.spjall.core.ModerationState
import samtak.spjall.ui.AVATAR_INITIALS
import samtak.spjall.ui.AvatarInitials
import samtak.spjall.ui.SpjallTheme

@RunWith(AndroidJUnit4::class)
class CommentComposerTest {
    @get:Rule val compose = createComposeRule()

    private val sent = mutableListOf<String>()

    private fun text(id: Int) = InstrumentationRegistry.getInstrumentation().targetContext.getString(id)

    private fun show(
        me: OwnAccount? = OwnAccount("a1", "Jón Jónsson", null),
        sending: Boolean = false,
    ) = compose.setContent {
        SpjallTheme {
            var draft by remember { mutableStateOf("") }
            CommentComposer(me, draft, sending, onText = { draft = it }, onSend = { sent += draft })
        }
    }

    @Test
    fun sendIsDisabledWhileEmptyAndEnabledAfterTypingAndSendsTheText() {
        show()
        compose.onNodeWithContentDescription(text(R.string.comment_publish)).assertIsNotEnabled()
        compose.onNodeWithText(text(R.string.post_write_comment)).performTextInput("Takk fyrir")
        compose.onNodeWithContentDescription(text(R.string.comment_publish)).assertIsEnabled().performClick()
        assertEquals(listOf("Takk fyrir"), sent)
    }

    @Test
    fun sendIsDisabledWhileSending() {
        compose.setContent {
            SpjallTheme { CommentComposer(null, "Halló", true, onText = {}, onSend = {}) }
        }
        compose.onNodeWithContentDescription(text(R.string.comment_publish)).assertIsNotEnabled()
    }

    @Test
    fun thePhotoButtonAsksForAPickAndAPickedImageShowsOnceWithAnXThatRemovesIt() {
        var picks = 0
        var removed = 0
        val file = java.io.File.createTempFile("picked", ".jpg").apply { deleteOnExit() }
        compose.setContent {
            var image by remember { mutableStateOf<String?>(null) }
            SpjallTheme {
                CommentComposer(
                    OwnAccount("a1", "Jón Jónsson", null),
                    "",
                    false,
                    onText = {},
                    onSend = {},
                    image = image,
                    onAddImage = {
                        picks++
                        image = file.path
                    },
                    onRemoveImage = {
                        removed++
                        image = null
                    },
                )
            }
        }
        compose.onNodeWithContentDescription(text(R.string.comment_publish)).assertIsNotEnabled()
        compose.onNodeWithContentDescription(text(R.string.comment_add_image)).performClick()
        assertEquals(1, picks)
        compose.onAllNodesWithContentDescription(text(R.string.post_image_remove)).assertCountEquals(1)
        compose.onNodeWithContentDescription(text(R.string.comment_publish)).assertIsEnabled()
        compose.onNodeWithContentDescription(text(R.string.post_image_remove)).performClick()
        assertEquals(1, removed)
        compose.onAllNodesWithContentDescription(text(R.string.post_image_remove)).assertCountEquals(0)
        compose.onNodeWithContentDescription(text(R.string.comment_publish)).assertIsNotEnabled()
    }

    @Test
    fun aRefusedImageIsNamedInTheBrandsWords() {
        compose.setContent {
            SpjallTheme {
                CommentComposer(
                    null,
                    "",
                    false,
                    onText = {},
                    onSend = {},
                    notice = CommunityViewModel.ImageNotice.TooLarge,
                )
            }
        }
        compose.onNodeWithText(text(R.string.post_image_too_large)).assertIsDisplayed()
    }

    @Test
    fun theReadersOwnInitialsShowAndNeverAQuestionMark() {
        show()
        compose.onNodeWithTag(AVATAR_INITIALS).assertIsDisplayed()
        compose.onNode(SemanticsMatcher.expectValue(AvatarInitials, "JJ")).assertIsDisplayed()
        compose.onAllNodes(SemanticsMatcher.expectValue(AvatarInitials, "?")).assertCountEquals(0)
    }

    @Test
    fun aCommentLineShowsLikeAndReply() {
        val comment =
            Comment(
                commentId = "c1",
                postId = "p1",
                parentCommentId = null,
                author = Author("a2", "Anna", verified = true),
                body = "Sammála",
                createdAt = 1_700_000_000_000uL,
                state = ModerationState.VISIBLE,
            )
        compose.setContent {
            SpjallTheme {
                CommentItem(comment, reported = false, onReport = {}, onDelete = null, onLike = {}, onReply = {})
            }
        }
        compose.onNodeWithText(text(R.string.comment_like)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.comment_reply)).assertIsDisplayed()
    }
}
