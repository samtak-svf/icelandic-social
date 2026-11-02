package samtak.spjall.social

import android.graphics.Bitmap
import android.view.KeyEvent
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import androidx.test.core.app.ApplicationProvider
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadows.ShadowDialog
import samtak.spjall.brand.R
import samtak.spjall.conversations.SCREENSHOT_DEVICE
import samtak.spjall.conversations.SCREENSHOT_SDK
import samtak.spjall.core.PostImage
import samtak.spjall.media.LocalPhotoDecoding
import samtak.spjall.ui.SpjallTheme
import samtak.spjall.ui.panLimit
import kotlin.coroutines.EmptyCoroutineContext

/**
 * The full-screen viewer a post's images open (decisions 0082, #119): a tap opens it at that image, close and
 * BACK dismiss it, and with several images a swipe moves to the next.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [SCREENSHOT_SDK], qualifiers = SCREENSHOT_DEVICE, fontScale = 1f)
class ImageViewerTest {
    @get:Rule val compose = createComposeRule()

    @get:Rule val folder = TemporaryFolder()

    private val context get() = ApplicationProvider.getApplicationContext<android.app.Application>()
    private val viewer get() = context.getString(R.string.image_viewer)
    private val close get() = context.getString(R.string.close)

    private fun numbered(
        n: Int,
        of: Int,
    ) = context.getString(R.string.post_image_alt_numbered, n, of)

    private fun show(count: Int) {
        val file =
            folder.newFile("photo.png").also { out ->
                out.outputStream().use { stream ->
                    Bitmap
                        .createBitmap(80, 60, Bitmap.Config.ARGB_8888)
                        .apply { eraseColor(0xFF3366AA.toInt()) }
                        .compress(Bitmap.CompressFormat.PNG, 100, stream)
                }
            }
        val post =
            post("p1", body = "Myndir").copy(images = List(count) { PostImage("m$it", 80u, 60u) })
        compose.setContent {
            CompositionLocalProvider(
                LocalPostImages provides PostImages { _, _ -> file.path },
                LocalPhotoDecoding provides EmptyCoroutineContext,
            ) {
                SpjallTheme { PostImageGrid(post) }
            }
        }
        compose.waitForIdle()
    }

    private fun opened() = compose.onAllNodesWithContentDescription(viewer)

    @Test
    fun aPostShowsFourImagesAndHowManyMoreAndTheViewerHasThemAll() {
        show(6)
        compose.onNodeWithContentDescription(numbered(4, 6)).assertExists()
        compose.onNodeWithContentDescription(numbered(5, 6)).assertDoesNotExist()
        compose.onNodeWithText(context.getString(R.string.post_images_more, 2)).assertExists()
        compose.onNodeWithContentDescription(numbered(4, 6)).performClick()
        compose.waitForIdle()
        opened().assertCountEquals(1)
        repeat(2) {
            compose.onNode(hasContentDescription(viewer)).performTouchInput { swipeLeft() }
            compose.waitForIdle()
        }
        compose.onNodeWithContentDescription(numbered(6, 6)).assertExists()
    }

    @Test
    fun aPostOfFourImagesSaysNothingMore() {
        show(4)
        compose.onNodeWithContentDescription(numbered(4, 4)).assertExists()
        compose.onNodeWithText(context.getString(R.string.post_images_more, 0)).assertDoesNotExist()
    }

    @Test
    fun aTapOnAnImageOpensTheViewerAtThatImage() {
        show(3)
        opened().assertCountEquals(0)
        compose.onNodeWithContentDescription(numbered(2, 3)).performClick()
        compose.waitForIdle()
        opened().assertCountEquals(1)
        // The grid's image and the viewer's page both carry the description; no other page is shown.
        compose.onAllNodesWithContentDescription(numbered(2, 3)).assertCountEquals(2)
        compose.onAllNodesWithContentDescription(numbered(1, 3)).assertCountEquals(1)
        compose.onAllNodesWithContentDescription(numbered(3, 3)).assertCountEquals(1)
    }

    @Test
    fun aCommentsImageSitsUnderItsTextAndATapOpensItInTheViewer() {
        val file =
            folder.newFile("comment.png").also { out ->
                out.outputStream().use { stream ->
                    Bitmap
                        .createBitmap(80, 60, Bitmap.Config.ARGB_8888)
                        .apply { eraseColor(0xFF3366AA.toInt()) }
                        .compress(Bitmap.CompressFormat.PNG, 100, stream)
                }
            }
        val comment = comment("c1", "p1", "Sjáið þetta").copy(images = listOf(PostImage("m1", 80u, 60u)))
        compose.setContent {
            CompositionLocalProvider(
                LocalPostImages provides PostImages { _, _ -> file.path },
                LocalPhotoDecoding provides EmptyCoroutineContext,
            ) {
                SpjallTheme {
                    CommentItem(comment, reported = false, onReport = {}, onDelete = null, onLike = {}, onReply = null)
                }
            }
        }
        compose.waitForIdle()
        val alt = context.getString(R.string.comment_image_alt)
        opened().assertCountEquals(0)
        compose.onNodeWithContentDescription(alt).performClick()
        compose.waitForIdle()
        opened().assertCountEquals(1)
        // The bubble's image and the viewer's single page both carry the comment's description.
        compose.onAllNodesWithContentDescription(alt).assertCountEquals(2)
    }

    @Test
    fun aSingleImageOpensTheViewerWithItsDescription() {
        show(1)
        compose.onNodeWithContentDescription(context.getString(R.string.post_image_alt)).performClick()
        compose.waitForIdle()
        opened().assertCountEquals(1)
        compose.onAllNodesWithContentDescription(context.getString(R.string.post_image_alt)).assertCountEquals(2)
    }

    @Test
    fun theCloseButtonDismissesIt() {
        show(2)
        compose.onNodeWithContentDescription(numbered(1, 2)).performClick()
        compose.waitForIdle()
        opened().assertCountEquals(1)
        compose.onNodeWithContentDescription(close).performClick()
        compose.waitForIdle()
        opened().assertCountEquals(0)
    }

    @Test
    fun backDismissesIt() {
        show(2)
        compose.onNodeWithContentDescription(numbered(1, 2)).performClick()
        compose.waitForIdle()
        opened().assertCountEquals(1)
        compose.runOnUiThread {
            val window = checkNotNull(ShadowDialog.getLatestDialog()).window!!.decorView
            window.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_BACK))
            window.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_BACK))
        }
        compose.waitForIdle()
        opened().assertCountEquals(0)
    }

    @Test
    fun aSwipeMovesToTheNextImage() {
        show(3)
        compose.onNodeWithContentDescription(numbered(1, 3)).performClick()
        compose.waitForIdle()
        compose.onAllNodesWithContentDescription(numbered(2, 3)).assertCountEquals(1)
        compose.onNode(hasContentDescription(viewer)).performTouchInput { swipeLeft() }
        compose.waitForIdle()
        // Now page 2 shows in the viewer as well as in the grid; page 1 is the grid's alone.
        compose.onAllNodesWithContentDescription(numbered(2, 3)).assertCountEquals(2)
        compose.onAllNodesWithContentDescription(numbered(1, 3)).assertCountEquals(1)
    }

    @Test
    fun theOpenViewer() {
        show(3)
        compose.onNodeWithContentDescription(numbered(2, 3)).performClick()
        compose.waitForIdle()
        compose.onNode(hasContentDescription(viewer)).captureRoboImage()
    }

    @Test
    fun aZoomedImageCannotBePannedOutOfSight() {
        // 400x300 image in a 1000x2000 area at 3x: the pan stays within what the zoom hides.
        val limit = panLimit(1000f, 750f, 1000f, 2000f, 3f)
        assertEquals(1000f, limit.first, 0.01f)
        assertEquals(125f, limit.second, 0.01f)
        assertEquals(0f to 0f, panLimit(1000f, 750f, 1000f, 2000f, 1f))
    }
}
