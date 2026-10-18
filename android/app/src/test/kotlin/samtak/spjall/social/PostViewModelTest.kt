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
import samtak.spjall.account.Problem
import samtak.spjall.account.unreachable
import samtak.spjall.core.ReactionKind
import samtak.spjall.core.ReportReason
import samtak.spjall.core.ReportTarget
import samtak.spjall.core.ReportTargetKind

@OptIn(ExperimentalCoroutinesApi::class)
class PostViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val social = FakeSocial()

    @Before fun main() = Dispatchers.setMain(dispatcher)

    @After fun reset() = Dispatchers.resetMain()

    @Before fun posts() {
        social.posts["k1"] = mutableListOf(post("p1", comments = 2uL))
        social.comments["p1"] = mutableListOf(comment("c1", "p1"), comment("c2", "p1"))
    }

    private fun TestScope.model() = PostViewModel("p1", social, dispatcher).also { advanceUntilIdle() }

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
}
