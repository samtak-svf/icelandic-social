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
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import samtak.spjall.core.CoreException
import samtak.spjall.core.ReportReason
import samtak.spjall.core.WallAudience

/** The wall on the person screen (0115): report and block, the composer, the audience, the bio. */
@OptIn(ExperimentalCoroutinesApi::class)
class PersonWallViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val social = FakeSocial()

    @Before fun main() = Dispatchers.setMain(dispatcher)

    @After fun reset() = Dispatchers.resetMain()

    @Before fun anna() {
        social.people["a2"] = profile(anna)
        social.people[self.accountId] = profile(self)
    }

    private fun TestScope.model(id: String = "a2") = PersonViewModel(id, social, dispatcher).also { advanceUntilIdle() }

    @Test
    fun blockingLeavesAndAskedTheCoreToBlock() =
        runTest(dispatcher) {
            val model = model()
            model.block()
            advanceUntilIdle()
            assertTrue("blockPerson a2" in social.calls)
            assertTrue(model.state.value.blocked)
        }

    @Test
    fun aRefusedBlockDoesNotLeave() =
        runTest(dispatcher) {
            val model = model()
            social.failNext = CoreException.Refused(500u, "x", null)
            model.block()
            advanceUntilIdle()
            assertFalse(model.state.value.blocked)
        }

    @Test
    fun reportingTargetsTheAccountAndShowsItWasSent() =
        runTest(dispatcher) {
            val model = model()
            model.report(ReportReason.SPAM, "note")
            advanceUntilIdle()
            assertTrue(social.calls.any { it.startsWith("report") && "a2" in it })
            assertTrue(model.state.value.reported)
        }

    @Test
    fun theComposerWritesToTheChosenAudienceAndClears() =
        runTest(dispatcher) {
            val model = model(self.accountId)
            model.onDraft(" Halló ")
            model.onAudience(WallAudience.EVERYONE)
            model.publish()
            advanceUntilIdle()
            assertTrue("createWallPost EVERYONE Halló" in social.calls)
            assertEquals("", model.state.value.draft)
            assertEquals(1, model.state.value.posts.size)
        }

    @Test
    fun aFailedPublishKeepsTheDraft() =
        runTest(dispatcher) {
            val model = model(self.accountId)
            model.onDraft("Halló")
            social.wallFailure = CoreException.Refused(500u, "x", null)
            model.publish()
            advanceUntilIdle()
            assertEquals("Halló", model.state.value.draft)
            val posts = model.state.value.posts
            assertTrue(posts.isEmpty())
        }

    @Test
    fun changingAPostsAudienceShowsTheNewOneOnTheCard() =
        runTest(dispatcher) {
            social.wallPostsOf[self.accountId] = mutableListOf(post("w1", author = self))
            val model = model(self.accountId)
            model.setAudience("w1", WallAudience.EVERYONE)
            advanceUntilIdle()
            assertTrue("setPostAudience w1 EVERYONE" in social.calls)
            val shown = model.state.value.posts
            val card = shown.single()
            assertEquals(WallAudience.EVERYONE, card.audience)
        }

    @Test
    fun theBioIsSavedTrimmedAndShown() =
        runTest(dispatcher) {
            val model = model(self.accountId)
            model.saveBio("  Hæ  ")
            advanceUntilIdle()
            assertTrue("setBio Hæ" in social.calls)
            val wall = model.state.value.wall
            assertEquals("Hæ", wall?.bio)
        }

    @Test
    fun theImagesTabLoadsOnFirstOpenOnly() =
        runTest(dispatcher) {
            val model = model()
            model.selectTab(WallTab.IMAGES)
            advanceUntilIdle()
            model.selectTab(WallTab.POSTS)
            model.selectTab(WallTab.IMAGES)
            advanceUntilIdle()
            assertEquals(1, social.calls.count { it == "wallImages a2" })
            assertTrue(model.state.value.imagesLoaded)
        }
}
