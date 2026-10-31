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
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import samtak.spjall.conversation.Picked
import samtak.spjall.core.CoreException
import samtak.spjall.core.Poll
import samtak.spjall.core.PollOption
import samtak.spjall.core.ReportReason
import samtak.spjall.core.ReportTarget
import samtak.spjall.core.ReportTargetKind
import java.io.File

/** Images and polls on the wall composer, and a poll on a wall post (0115): the community's rules, on a wall. */
@OptIn(ExperimentalCoroutinesApi::class)
class PersonWallComposerTest {
    private val dispatcher = StandardTestDispatcher()
    private val social = FakeSocial()

    @Before fun main() = Dispatchers.setMain(dispatcher)

    @After fun reset() = Dispatchers.resetMain()

    @Before fun people() {
        social.people["a2"] = profile(anna)
        social.people[self.accountId] = profile(self)
    }

    private fun TestScope.model(id: String = self.accountId) =
        PersonViewModel(id, social, dispatcher).also { advanceUntilIdle() }

    private fun TestScope.picked(model: PersonViewModel): String {
        val file = File.createTempFile("wall", ".jpg")
        file.writeText("jpeg")
        file.deleteOnExit()
        model.pick(listOf(Picked("image/jpeg", file.length()) { file }))
        advanceUntilIdle()
        val state = model.state.value
        return state.picked.single()
    }

    @Test
    fun aPickedImageIsUploadedAndWrittenWithThePost() =
        runTest(dispatcher) {
            val model = model()
            val path = picked(model)
            model.onDraft("Mynd")
            model.publish()
            advanceUntilIdle()
            assertTrue("uploadWallImage $path" in social.calls)
            assertEquals(listOf("m1"), social.lastWallMedia)
            val state = model.state.value
            assertTrue(state.picked.isEmpty())
            assertEquals("", state.draft)
            assertEquals(1, state.posts.size)
        }

    @Test
    fun aFailedUploadKeepsTheDraftAndTheImageAndShowsTheRefusal() =
        runTest(dispatcher) {
            val model = model()
            val path = picked(model)
            model.onDraft("Mynd")
            social.wallFailure = CoreException.Refused(500u, "x", null)
            model.publish()
            advanceUntilIdle()
            val state = model.state.value
            assertEquals("Mynd", state.draft)
            assertEquals(listOf(path), state.picked)
            assertNotNull(state.problem)
            assertTrue(state.posts.isEmpty())
            assertTrue(!state.publishing)
        }

    @Test
    fun anImageTheServerRefusesIsNamedAndTheDraftStays() =
        runTest(dispatcher) {
            val model = model()
            picked(model)
            model.onDraft("Mynd")
            social.wallFailure = CoreException.Refused(413u, "too_large", null)
            model.publish()
            advanceUntilIdle()
            val state = model.state.value
            assertEquals(CommunityViewModel.ImageNotice.TooLarge, state.imageNotice)
            assertEquals("Mynd", state.draft)
            assertEquals(1, state.picked.size)
        }

    @Test
    fun aPollIsWrittenWithItsOptionsAndAFailedPublishKeepsIt() =
        runTest(dispatcher) {
            val model = model()
            model.togglePoll()
            model.pollOption(0, " Já ")
            model.pollOption(1, "Nei")
            model.onDraft("Spurning")
            social.wallFailure = CoreException.Refused(500u, "x", null)
            model.publish()
            advanceUntilIdle()
            assertEquals(listOf(" Já ", "Nei"), model.state.value.poll)
            assertNotNull(model.state.value.problem)
            social.wallFailure = null
            model.publish()
            advanceUntilIdle()
            assertEquals(listOf("Já", "Nei"), social.lastWallPoll)
            assertNull(model.state.value.poll)
        }

    @Test
    fun aPollNeedsValidOptionsAndExcludesImages() =
        runTest(dispatcher) {
            val model = model()
            model.togglePoll()
            model.onDraft("Spurning")
            assertTrue(!model.state.value.postable)
            model.pollOption(0, "Já")
            model.pollOption(1, "Nei")
            assertTrue(model.state.value.postable)
            val file = File.createTempFile("wall", ".jpg")
            file.deleteOnExit()
            model.pick(listOf(Picked("image/jpeg", 4) { file }))
            advanceUntilIdle()
            assertEquals(emptyList<String>(), model.state.value.picked)
            model.togglePoll()
            picked(model)
            model.togglePoll()
            assertNull(model.state.value.poll)
        }

    @Test
    fun anImageOverTheLimitIsLeftOutWithANotice() =
        runTest(dispatcher) {
            val model = model()
            model.pick(listOf(Picked("image/jpeg", IMAGE_LIMIT + 1) { error("not read") }))
            advanceUntilIdle()
            assertEquals(CommunityViewModel.ImageNotice.TooLarge, model.state.value.imageNotice)
            assertEquals(emptyList<String>(), model.state.value.picked)
        }

    @Test
    fun aVoteOnAWallPostChangesItsPoll() =
        runTest(dispatcher) {
            val poll = Poll(listOf(PollOption("o0", "Já", 0uL), PollOption("o1", "Nei", 0uL)), 0uL, null, false)
            val wallPost = post("w1", communityId = "w-a2", author = anna, poll = poll).copy(wallOwner = "a2")
            social.wallPostsOf["a2"] = mutableListOf(wallPost)
            social.posts["w-a2"] = mutableListOf(wallPost)
            val model = model("a2")
            model.vote("w1", "o1")
            advanceUntilIdle()
            assertTrue("votePoll w1 o1" in social.calls)
            val state = model.state.value
            val voted = state.posts.single()
            assertEquals("o1", voted.poll?.mine)
            assertTrue(state.answering.isEmpty())
        }

    @Test
    fun reportingAWallPostTargetsThePostNotTheAccount() =
        runTest(dispatcher) {
            val wallPost = post("w1", communityId = "w-a2", author = anna).copy(wallOwner = "a2")
            social.wallPostsOf["a2"] = mutableListOf(wallPost)
            val model = model("a2")
            model.report(ReportTarget(ReportTargetKind.POST, "w1"), ReportReason.SPAM, "")
            advanceUntilIdle()
            assertTrue(social.calls.any { it.startsWith("report") && "w1" in it })
            assertEquals(setOf("w1"), model.state.value.reportedPosts)
            assertTrue(!model.state.value.reported)
        }
}
