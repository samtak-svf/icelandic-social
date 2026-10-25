package samtak.spjall.social

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import samtak.spjall.account.Problem
import samtak.spjall.account.unreachable
import samtak.spjall.conversation.Picked
import samtak.spjall.core.CoreException
import samtak.spjall.core.Poll
import samtak.spjall.core.PollOption
import samtak.spjall.core.ReactionKind
import samtak.spjall.core.ReportReason
import samtak.spjall.core.ReportTarget
import samtak.spjall.core.ReportTargetKind
import java.io.File

@OptIn(ExperimentalCoroutinesApi::class)
class PostViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val social = FakeSocial()

    @Before fun main() = Dispatchers.setMain(dispatcher)

    @After fun reset() = Dispatchers.resetMain()

    @Before fun posts() {
        social.communities["k1"] = community("k1", role = samtak.spjall.core.CommunityRole.MEMBER)
        social.posts["k1"] = mutableListOf(post("p1", comments = 2uL))
        social.comments["p1"] = mutableListOf(comment("c1", "p1"), comment("c2", "p1"))
    }

    private fun TestScope.model() = PostViewModel("p1", social, dispatcher).also { advanceUntilIdle() }

    @Test
    fun keepsThisAccountsNameForTheComposerAvatarFromTheOneRead() =
        runTest(dispatcher) {
            social.posts["k1"] = mutableListOf(post("p1"))
            social.myName = "Jón Jónsson"
            val model = model()
            assertEquals(
                "Jón Jónsson",
                model.state.value.me
                    ?.name,
            )
            assertEquals(1, social.calls.count { it == "me" })
        }

    @Test
    fun showsThePostAndItsCommentsOldestFirst() =
        runTest(dispatcher) {
            val state = model().state.value
            assertEquals("p1", state.post?.postId)
            assertEquals(listOf("c1", "c2"), state.comments.map { it.commentId })
        }

    @Test
    fun aSentCommentIsAddedAtTheEndAndCounted() =
        runTest(dispatcher) {
            val model = model()
            model.draft(" Takk ")
            model.send()
            advanceUntilIdle()
            assertTrue("createComment p1 Takk" in social.calls)
            assertEquals(
                listOf("c1", "c2", "c-new0"),
                model.state.value.comments
                    .map { it.commentId },
            )
            assertEquals(
                3uL,
                model.state.value.post
                    ?.commentCount,
            )
            assertEquals("", model.state.value.draft)
        }

    @Test
    fun aReplyCarriesItsParentAndClearsReplyingStateAfterSend() =
        runTest(dispatcher) {
            val model = model()
            model.onReplyTo(comment("c1", "p1"))
            model.draft("Svar")
            model.send()
            advanceUntilIdle()
            assertTrue("createComment p1 Svar c1" in social.calls)
            assertEquals(
                "c1",
                model.state.value.comments
                    .last()
                    .parentCommentId,
            )
            assertEquals(null, model.state.value.replyingTo)
        }

    @Test
    fun aSentCommentWaitsForItsPageWhileNewerPagesRemain() =
        runTest(dispatcher) {
            social.pageSize = 1
            val model = model()
            model.draft("Takk")
            model.send()
            advanceUntilIdle()
            assertEquals(
                listOf("c1"),
                model.state.value.comments
                    .map { it.commentId },
            )
            model.more()
            advanceUntilIdle()
            model.more()
            advanceUntilIdle()
            assertEquals(
                listOf("c1", "c2", "c-new0"),
                model.state.value.comments
                    .map { it.commentId },
            )
        }

    @Test
    fun anEmptyCommentIsNotSent() =
        runTest(dispatcher) {
            val model = model()
            model.draft("   ")
            model.send()
            advanceUntilIdle()
            assertFalse(social.calls.any { it.startsWith("createComment") })
        }

    private fun picked(): Pair<File, Picked> {
        val file = File.createTempFile("picked", ".jpg").apply { deleteOnExit() }
        file.writeBytes(byteArrayOf(1, 2, 3))
        return file to Picked("image/jpeg", file.length()) { file }
    }

    @Test
    fun aPickedImageIsUploadedToThePostsCommunityAndSentWithTheComment() =
        runTest(dispatcher) {
            val model = model()
            val (file, one) = picked()
            model.pick(one)
            advanceUntilIdle()
            assertEquals(file.path, model.state.value.image)
            model.draft("Mynd")
            model.send()
            advanceUntilIdle()
            val media = "m-${file.name}"
            assertTrue("uploadPostImage k1 ${file.path}" in social.calls)
            assertTrue("createComment p1 Mynd media=$media" in social.calls)
            val sent =
                model.state.value.comments
                    .last()
            assertEquals(listOf(media), sent.images.map { it.mediaId })
            assertEquals(null, model.state.value.image)
            assertEquals("", model.state.value.draft)
        }

    @Test
    fun aCommentMayBeAnImageAloneButNotNothing() =
        runTest(dispatcher) {
            val model = model()
            model.send()
            advanceUntilIdle()
            assertFalse(social.calls.any { it.startsWith("createComment") })
            model.pick(picked().second)
            advanceUntilIdle()
            assertTrue(model.state.value.sendable)
            model.send()
            advanceUntilIdle()
            assertTrue(social.calls.any { it.startsWith("createComment p1 media=") })
        }

    @Test
    fun aFailedSendKeepsTheTextAndTheImageAndAnotherPickReplacesIt() =
        runTest(dispatcher) {
            val model = model()
            val (first, one) = picked()
            model.pick(one)
            model.draft("Mynd")
            advanceUntilIdle()
            social.refuseImage = CoreException.Refused(422u, "too_large", null)
            model.send()
            advanceUntilIdle()
            val state = model.state.value
            assertEquals("Mynd", state.draft)
            assertEquals(first.path, state.image)
            assertEquals(CommunityViewModel.ImageNotice.TooLarge, state.imageNotice)
            assertFalse(state.sending)
            val (second, two) = picked()
            model.pick(two)
            advanceUntilIdle()
            assertEquals(second.path, model.state.value.image)
            assertFalse(first.exists())
        }

    @Test
    fun anImageOverTheLimitIsNotTakenAndRemovingOneEmptiesTheBox() =
        runTest(dispatcher) {
            val model = model()
            model.pick(Picked("image/jpeg", IMAGE_LIMIT + 1) { error("not read") })
            advanceUntilIdle()
            assertEquals(null, model.state.value.image)
            assertEquals(CommunityViewModel.ImageNotice.TooLarge, model.state.value.imageNotice)
            val (file, one) = picked()
            model.pick(one)
            advanceUntilIdle()
            model.unpick()
            advanceUntilIdle()
            assertEquals(null, model.state.value.image)
            assertFalse(file.exists())
        }

    @Test
    fun theReactionChanges() =
        runTest(dispatcher) {
            val model = model()
            model.react(ReactionKind.LOVE)
            advanceUntilIdle()
            assertEquals(
                ReactionKind.LOVE,
                model.state.value.post
                    ?.myReaction,
            )
            model.react(ReactionKind.SAD)
            advanceUntilIdle()
            assertEquals(
                ReactionKind.SAD,
                model.state.value.post
                    ?.myReaction,
            )
            assertEquals(
                1uL,
                model.state.value.post
                    ?.reactions
                    ?.single()
                    ?.count,
            )
        }

    @Test
    fun likingACommentShowsAtOnceAndUnlikingTakesItBack() =
        runTest(dispatcher) {
            val model = model()
            model.likeComment("c1")
            assertTrue(
                model.state.value.comments
                    .first { it.commentId == "c1" }
                    .liked,
            )
            assertEquals(
                1uL,
                model.state.value.comments
                    .first { it.commentId == "c1" }
                    .likes,
            )
            advanceUntilIdle()
            assertTrue("likeComment c1" in social.calls)
            model.likeComment("c1")
            advanceUntilIdle()
            assertTrue("unlikeComment c1" in social.calls)
            assertFalse(
                model.state.value.comments
                    .first { it.commentId == "c1" }
                    .liked,
            )
            assertEquals(
                0uL,
                model.state.value.comments
                    .first { it.commentId == "c1" }
                    .likes,
            )
        }

    @Test
    fun aRefusedLikeIsRolledBackAndReported() =
        runTest(dispatcher) {
            val model = model()
            social.failNext = unreachable()
            model.likeComment("c1")
            advanceUntilIdle()
            val c1 =
                model.state.value.comments
                    .first { it.commentId == "c1" }
            assertFalse(c1.liked)
            assertEquals(0uL, c1.likes)
            assertTrue(model.state.value.problem != null)
        }

    @Test
    fun aCommentCanBeReported() =
        runTest(dispatcher) {
            val model = model()
            model.report(ReportTarget(ReportTargetKind.COMMENT, "c2"), ReportReason.HARASSMENT, "")
            advanceUntilIdle()
            assertTrue("report COMMENT c2 HARASSMENT" in social.calls)
            assertEquals(setOf("c2"), model.state.value.reported)
        }

    @Test
    fun aFailedSendKeepsTheDraft() =
        runTest(dispatcher) {
            val model = model()
            model.draft("Takk")
            social.failNext = unreachable()
            model.send()
            advanceUntilIdle()
            assertEquals(Problem.Unreachable, model.state.value.problem)
            assertEquals("Takk", model.state.value.draft)
            model.retry()
            advanceUntilIdle()
            assertEquals("", model.state.value.draft)
        }

    @Test
    fun deletingTheOwnPostGoesBackToItsCommunity() =
        runTest(dispatcher) {
            social.posts["k1"] = mutableListOf(post("p1", author = self))
            val model = model()
            assertEquals(
                "a1",
                model.state.value.me
                    ?.id,
            )
            val gone = mutableListOf<String>()
            backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { model.deleted.toList(gone) }
            model.deletePost()
            advanceUntilIdle()
            assertTrue("deletePost p1" in social.calls)
            assertEquals(listOf("k1"), gone)
        }

    @Test
    fun aDeletedCommentLeavesTheListAndTheCount() =
        runTest(dispatcher) {
            social.comments["p1"] = mutableListOf(comment("c1", "p1", author = self), comment("c2", "p1"))
            val model = model()
            model.deleteComment("c1")
            advanceUntilIdle()
            assertTrue("deleteComment c1" in social.calls)
            assertEquals(
                listOf("c2"),
                model.state.value.comments
                    .map { it.commentId },
            )
            assertEquals(
                1uL,
                model.state.value.post
                    ?.commentCount,
            )
        }

    @Test
    fun aPollOnThePostScreenIsVotedWithdrawnAndClosed() =
        runTest(dispatcher) {
            social.posts["k1"] = mutableListOf(post("p1", poll = poll(), own = true))
            val model = model()
            model.vote("o1")
            advanceUntilIdle()
            assertEquals("o1", model.pollOf().mine)
            assertFalse(model.state.value.answering)
            model.withdrawVote()
            advanceUntilIdle()
            assertNull(model.pollOf().mine)
            model.closePoll()
            advanceUntilIdle()
            assertTrue(model.pollOf().closed)
            model.vote("o0")
            advanceUntilIdle()
            assertEquals(Problem.PollClosed, model.state.value.problem)
            assertFalse(model.state.value.answering)
        }

    @Test
    fun aFourthPinIsRefusedWithThePinFullProblem() =
        runTest(dispatcher) {
            social.posts["k1"] = mutableListOf(post("p1"), post("p2"), post("p3"), post("p4"))
            social.featuredIds["k1"] = listOf("p2", "p3", "p4")
            val model = model()
            model.pin(true)
            advanceUntilIdle()
            assertEquals(Problem.PinFull, model.state.value.problem)
        }
}

private fun PostViewModel.pollOf() = state.value.post!!.poll!!

private fun poll(closed: Boolean = false) =
    Poll(listOf(PollOption("o0", "Já", 0uL), PollOption("o1", "Nei", 0uL)), 0uL, null, closed)
