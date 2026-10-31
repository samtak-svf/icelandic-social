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
        val removed = ModerationLogAction.REMOVE_POST
        assertEquals(R.string.statement_review_open, review(ModerationReviewState.OPEN).sentence(removed))
        assertEquals(R.string.statement_review_upheld, review(ModerationReviewState.UPHELD).sentence(removed))
        assertEquals(
            R.string.statement_review_overturned,
            review(ModerationReviewState.OVERTURNED, true).sentence(removed),
        )
        assertEquals(
            R.string.statement_review_overturned_not_restored,
            review(ModerationReviewState.OVERTURNED).sentence(removed),
        )
        assertNull(review(ModerationReviewState.UNKNOWN).sentence(removed))
    }

    @Test
    fun anOverturnedSuspensionIsLiftedOrStillStandsLater() {
        val suspended = ModerationLogAction.SUSPEND_ACCOUNT

        fun overturned(restored: Boolean) =
            ModerationReview(ModerationReviewState.OVERTURNED, 1uL, null, null, restored)
        assertEquals(R.string.statement_review_overturned_lifted, overturned(true).sentence(suspended))
        assertEquals(R.string.statement_review_overturned_later_stands, overturned(false).sentence(suspended))
        assertEquals(
            R.string.statement_review_open,
            ModerationReview(ModerationReviewState.OPEN, 1uL, null, null, false).sentence(suspended),
        )
    }

    @Test
    fun theClearedBioAndCoverAndTheReadReportedHaveTheirOwnWords() {
        assertEquals(
            Wording(R.string.moderation_decision_clear_account_bio),
            ModerationLogAction.CLEAR_ACCOUNT_BIO.statementLabel(),
        )
        assertEquals(
            Wording(R.string.moderation_decision_clear_account_cover),
            ModerationLogAction.CLEAR_ACCOUNT_COVER.statementLabel(),
        )
        assertEquals(
            Wording(R.string.moderation_decision_read_reported),
            ModerationLogAction.READ_REPORTED.statementLabel(),
        )
        // The community log words them as the statements do.
        ModerationLogAction.entries
            .filter { it.name in setOf("CLEAR_ACCOUNT_BIO", "CLEAR_ACCOUNT_COVER", "READ_REPORTED") }
            .forEach { assertEquals(it.statementLabel(), it.logWording()) }
    }

    @Test
    fun aSuspensionSaysWhenItEndsOrThatItHasNoEnd() {
        assertEquals(
            Wording(R.string.moderation_decision_suspend_account_open),
            ModerationLogAction.SUSPEND_ACCOUNT.statementLabel(null),
        )
        assertEquals(
            Wording(R.string.moderation_decision_suspend_account_until, 1_800_000_000_000uL),
            ModerationLogAction.SUSPEND_ACCOUNT.statementLabel(1_800_000_000_000uL),
        )
        assertEquals(
            Wording(R.string.moderation_decision_unsuspend_account),
            ModerationLogAction.UNSUSPEND_ACCOUNT.statementLabel(),
        )
        // The log words a suspension as its statement is worded.
        assertEquals(
            ModerationLogAction.SUSPEND_ACCOUNT.statementLabel(5uL),
            ModerationLogAction.SUSPEND_ACCOUNT.logWording(5uL),
        )
    }

    @Test
    fun anActionALaterServerAddsReadsAsDone() {
        assertEquals(R.string.moderation_decision_remove_post, ModerationLogAction.REMOVE_POST.statementLabel().id)
        assertEquals(R.string.moderation_done, ModerationLogAction.UNKNOWN.statementLabel().id)
        assertEquals(R.string.moderation_done, ModerationLogAction.UNKNOWN.logWording().id)
    }

    private fun StatementsViewModel.ids() = state.value.statements.map { it.entryId }

    private fun StatementsViewModel.only() = state.value.statements.single()
}
