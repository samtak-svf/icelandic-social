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
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import samtak.spjall.account.Problem
import samtak.spjall.account.unreachable
import samtak.spjall.brand.R
import samtak.spjall.core.LogTarget
import samtak.spjall.core.LogTargetKind
import samtak.spjall.core.ModerationLogAction
import samtak.spjall.core.ModerationReview
import samtak.spjall.core.ModerationReviewState
import samtak.spjall.core.ModerationStatement

@OptIn(ExperimentalCoroutinesApi::class)
class StatementsViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val social = FakeSocial()

    @Before fun main() = Dispatchers.setMain(dispatcher)

    @After fun reset() = Dispatchers.resetMain()

    private fun statement(
        id: ULong,
        canAsk: Boolean = true,
    ) = ModerationStatement(
        entryId = id,
        action = ModerationLogAction.REMOVE_POST,
        target = LogTarget(LogTargetKind.POST, "p$id"),
        communityId = "k1",
        reason = "Ástæða",
        createdAt = 1uL,
        body = "Texti",
        canAsk = canAsk,
        review = null,
    )

    private fun TestScope.model() = StatementsViewModel(social, dispatcher).also { advanceUntilIdle() }

    @Test
    fun listsTheStatementsAndSaysWhenThereAreNone() =
        runTest(dispatcher) {
            assertTrue(
                model().state.value.let {
                    it.loaded && it.statements.isEmpty()
                },
            )
            social.statements = listOf(statement(2uL), statement(1uL))
            assertEquals(listOf(2uL, 1uL), model().ids())
        }

    @Test
    fun readsThePagesInOrder() =
        runTest(dispatcher) {
            social.statements = listOf(statement(3uL), statement(2uL), statement(1uL))
            social.pageSize = 2
            val model = model()
            assertEquals(listOf(3uL, 2uL), model.ids())
            model.more()
            advanceUntilIdle()
            assertEquals(listOf(3uL, 2uL, 1uL), model.ids())
            assertNull(model.state.value.next)
        }

    @Test
    fun askingIsDoneOnceAndTheListIsAskedForAgain() =
        runTest(dispatcher) {
            social.statements = listOf(statement(7uL))
            val model = model()
            model.ask(7uL)
            advanceUntilIdle()
            assertTrue("askModerationReview 7" in social.calls)
            val asked = model.only()
            assertFalse(asked.canAsk)
            assertEquals(ModerationReviewState.OPEN, asked.review?.state)
        }

    @Test
    fun aFailedAskKeepsTheListAndRetriesTheAsk() =
        runTest(dispatcher) {
            social.statements = listOf(statement(7uL))
            val model = model()
            social.failNext = unreachable()
            model.ask(7uL)
            advanceUntilIdle()
            assertEquals(Problem.Unreachable, model.state.value.problem)
            assertTrue(model.only().canAsk)
            model.retry()
            advanceUntilIdle()
            assertNull(model.state.value.problem)
            assertFalse(model.only().canAsk)
        }

    @Test
    fun aReviewReadsByItsStateAndWhetherTheContentCameBack() {
        fun review(
            state: ModerationReviewState,
            restored: Boolean = false,
        ) = ModerationReview(state, 1uL, null, null, restored)
        assertEquals(R.string.statement_review_open, review(ModerationReviewState.OPEN).sentence())
        assertEquals(R.string.statement_review_upheld, review(ModerationReviewState.UPHELD).sentence())
        assertEquals(R.string.statement_review_overturned, review(ModerationReviewState.OVERTURNED, true).sentence())
        assertEquals(
            R.string.statement_review_overturned_not_restored,
            review(ModerationReviewState.OVERTURNED).sentence(),
        )
        assertNull(review(ModerationReviewState.UNKNOWN).sentence())
    }

    @Test
    fun anActionALaterServerAddsReadsAsDone() {
        assertEquals(R.string.moderation_decision_remove_post, ModerationLogAction.REMOVE_POST.statementLabel())
        assertEquals(R.string.moderation_done, ModerationLogAction.UNKNOWN.statementLabel())
    }

    private fun StatementsViewModel.ids() = state.value.statements.map { it.entryId }

    private fun StatementsViewModel.only() = state.value.statements.single()
}
