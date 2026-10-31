package samtak.spjall.social

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
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import samtak.spjall.conversation.Picked
import samtak.spjall.core.CommunityRole
import samtak.spjall.core.CoreException
import samtak.spjall.core.HomePage
import samtak.spjall.core.PostTarget
import samtak.spjall.core.WallAudience
import java.io.File

@OptIn(ExperimentalCoroutinesApi::class)
class FeedComposerViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val social = FakeSocial()
    private val wall = PostTarget.Wall(WallAudience.FRIENDS)

    @Before fun main() = Dispatchers.setMain(dispatcher)

    @After fun reset() = Dispatchers.resetMain()

    private fun TestScope.model() = FeedViewModel(social, dispatcher) { wall }.also { advanceUntilIdle() }

    @Test
    fun aCommunityTheComposerDoesNotOfferCannotBePostedTo() =
        runTest(dispatcher) {
            val model = model()
            model.onTarget(PostTarget.Community("k9", anonymous = false))
            model.onDraft("Halló")
            model.publish()
            advanceUntilIdle()
            assertTrue(social.written.isEmpty())
            assertEquals("Halló", model.state.value.draft)
        }

    @Test
    fun aPostSentClosesTheComposer() =
        runTest(dispatcher) {
            val model = model()
            model.openComposer()
            model.onDraft("Halló")
            model.publish()
            advanceUntilIdle()
            assertFalse(model.state.value.composing)
            assertEquals("", model.state.value.draft)
        }

    @Test
    fun aRefusalKeepsTheComposerOpenWithTheDraft() =
        runTest(dispatcher) {
            val model = model()
            model.openComposer()
            model.onDraft("Halló")
            social.failOn = "postTo"
            model.publish()
            advanceUntilIdle()
            assertTrue(model.state.value.composing)
            assertEquals("Halló", model.state.value.draft)
            assertNotNull(model.state.value.problem)
        }

    @Test
    fun aRefusedPostOfImagesAloneKeepsTheComposerOpen() =
        runTest(dispatcher) {
            val model = model()
            pickImage(model)
            model.openComposer()
            social.failOn = "postTo"
            model.publish()
            advanceUntilIdle()
            assertTrue(model.state.value.composing)
            assertEquals(1, model.attachments.state.value.picked.size)
        }

    @Test
    fun anImageNoticeKeepsTheComposerOpen() =
        runTest(dispatcher) {
            val model = model()
            pickImage(model)
            model.openComposer()
            social.failNext = CoreException.Refused(413u, "too_large", null)
            model.publish()
            advanceUntilIdle()
            assertTrue(model.state.value.composing)
            assertEquals(CommunityViewModel.ImageNotice.TooLarge, model.attachments.state.value.notice)
        }

    @Test
    fun aDismissedComposerKeepsTheDraft() =
        runTest(dispatcher) {
            val model = model()
            model.openComposer()
            model.onDraft("Halló")
            model.closeComposer()
            assertFalse(model.state.value.composing)
            assertEquals("Halló", model.state.value.draft)
        }

    @Test
    fun aRetryAfterACardFailedDoesNotPublishAgain() =
        runTest(dispatcher) {
            social.homePages += HomePage.End(listOf(post("p1").copy(wallOwner = "a2")))
            val model = model()
            model.onDraft("Halló")
            social.failOn = "postTo"
            model.publish()
            advanceUntilIdle()
            social.failOn = "react p1 👍"
            model.react("p1", "👍")
            advanceUntilIdle()
            assertNotNull(model.state.value.problem)
            social.failOn = null
            model.retry()
            advanceUntilIdle()
            assertTrue(social.written.isEmpty())
            assertNull(model.state.value.problem)
        }

    @Test
    fun aRememberedCommunityNoLongerOnOfferFallsBackToTheWall() =
        runTest(dispatcher) {
            val model =
                FeedViewModel(social, dispatcher) { PostTarget.Community("k9", anonymous = false) }
            advanceUntilIdle()
            assertEquals(wall, model.state.value.target)
        }

    @Test
    fun aRememberedCommunityStillOnOfferStays() =
        runTest(dispatcher) {
            social.offered += community("k1", role = CommunityRole.MEMBER)
            val target = PostTarget.Community("k1", anonymous = false)
            val model = FeedViewModel(social, dispatcher) { target }
            advanceUntilIdle()
            assertEquals(target, model.state.value.target)
        }

    @Test
    fun anotherPlaceSendsTheImagesAgain() =
        runTest(dispatcher) {
            social.offered += community("k1", role = CommunityRole.MEMBER)
            val model = model()
            pickImage(model)
            social.failOn = "postTo"
            model.publish()
            advanceUntilIdle()
            assertEquals(1, uploads())
            model.onTarget(PostTarget.Community("k1", anonymous = false))
            social.failOn = null
            model.publish()
            advanceUntilIdle()
            assertEquals(2, uploads())
        }

    private fun uploads() = social.calls.count { it.startsWith("uploadPostImageFor") }

    private fun pickImage(model: FeedViewModel) {
        val file = File.createTempFile("feed", ".jpg")
        file.writeBytes(byteArrayOf(1, 2, 3))
        model.attachments.pick(listOf(Picked("image/jpeg", file.length()) { file }))
        dispatcher.scheduler.advanceUntilIdle()
    }
}
