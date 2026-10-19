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
import samtak.spjall.core.Card
import samtak.spjall.core.ModerationAction
import samtak.spjall.core.ReportState
import samtak.spjall.core.ReportTargetKind

@OptIn(ExperimentalCoroutinesApi::class)
class ReportsViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val social = FakeSocial()

    @Before fun main() = Dispatchers.setMain(dispatcher)

    @After fun reset() = Dispatchers.resetMain()

    @Before fun queue() {
        social.posts["k1"] = mutableListOf(post("p1", body = "Rusl"))
        social.comments["p1"] = mutableListOf(comment("c1", "p1", body = "Dónalegt"))
        social.reports["k1"] =
            mutableListOf(
                report("r1", ReportTargetKind.POST, "p1"),
                report("r2", ReportTargetKind.COMMENT, "c1"),
                report("r3", ReportTargetKind.ACCOUNT, "a9"),
            )
    }

    private val now = 1_800_000_000_000L

    private fun TestScope.model() = ReportsViewModel("k1", social, { now }, dispatcher).also { advanceUntilIdle() }

    @Test
    fun showsEachReportWithTheCardOfWhatItNames() =
        runTest(dispatcher) {
            val state = model().state.value
            assertEquals(listOf("r1", "r2", "r3"), state.reports.map { it.reportId })
            assertTrue("cards p1,c1" in social.calls)
            assertEquals("Rusl", (state.cards["p1"] as Card.Post).excerpt)
            assertEquals("Dónalegt", (state.cards["c1"] as Card.Comment).excerpt)
            assertNull(state.cards["a9"])
        }

    @Test
    fun nothingIsDoneWithoutAReason() =
        runTest(dispatcher) {
            val model = model()
            model.act(model.state.value.reports[0], ReportsViewModel.Verb.Hide)
            model.reason("r1", "   ")
            model.act(model.state.value.reports[0], ReportsViewModel.Verb.Hide)
            advanceUntilIdle()
            assertFalse(social.calls.any { it.startsWith("moderate") })
        }

    @Test
    fun hidingAPostAnswersItsReport() =
        runTest(dispatcher) {
            val model = model()
            model.reason("r1", " ruslpóstur ")
            model.act(model.state.value.reports[0], ReportsViewModel.Verb.Hide)
            advanceUntilIdle()
            assertTrue("moderate k1 HIDE_POST p1 ruslpóstur r1" in social.calls)
            assertEquals(
                listOf("r2", "r3"),
                model.state.value.reports
                    .map { it.reportId },
            )
            assertTrue(model.state.value.done)
            assertNull(model.state.value.reasons["r1"])
        }

    @Test
    fun removingACommentAnswersItsReport() =
        runTest(dispatcher) {
            val model = model()
            model.reason("r2", "áreitni")
            model.act(model.state.value.reports[1], ReportsViewModel.Verb.Remove)
            advanceUntilIdle()
            assertTrue("moderate k1 REMOVE_COMMENT c1 áreitni r2" in social.calls)
        }

    @Test
    fun aReportIsClosedWithoutActing() =
        runTest(dispatcher) {
            val model = model()
            model.reason("r3", "ekkert að")
            model.act(model.state.value.reports[2], ReportsViewModel.Verb.Dismiss)
            advanceUntilIdle()
            assertTrue("closeReport r3 ekkert að" in social.calls)
            assertEquals(
                listOf("r1", "r2"),
                model.state.value.reports
                    .map { it.reportId },
            )
        }

    @Test
    fun anAccountIsNotHiddenFromHere() {
        val account = report("r3", ReportTargetKind.ACCOUNT, "a9")
        assertNull(account.action(ReportsViewModel.Verb.Hide))
        assertEquals(
            ModerationAction.REMOVE_POST,
            report("r1", ReportTargetKind.POST, "p1").action(ReportsViewModel.Verb.Remove),
        )
    }

    @Test
    fun aFailedActionCanBeTriedAgain() =
        runTest(dispatcher) {
            val model = model()
            model.reason("r1", "rusl")
            social.failNext = unreachable()
            model.act(model.state.value.reports[0], ReportsViewModel.Verb.Hide)
            advanceUntilIdle()
            assertEquals(Problem.Unreachable, model.state.value.problem)
            assertEquals(3, model.state.value.reports.size)
            model.retry()
            advanceUntilIdle()
            assertEquals(2, model.state.value.reports.size)
        }

    @Test
    fun theAuthorIsMutedForAPeriodUnmutedAndBanned() =
        runTest(dispatcher) {
            val model = model()
            model.reason("r1", "ítrekað")
            model.act(model.state.value.reports[0], ReportsViewModel.Verb.Mute)
            advanceUntilIdle()
            assertFalse("a mute needs a period", social.calls.any { it.startsWith("moderate") })
            model.act(model.state.value.reports[0], ReportsViewModel.Verb.Mute, ReportsViewModel.MutePeriod.Week)
            advanceUntilIdle()
            val week = now + 7L * 24 * 60 * 60 * 1000
            assertTrue("moderate k1 MUTE_MEMBER a2 ítrekað r1 $week" in social.calls)
            model.reason("r2", "aflétt")
            model.act(model.state.value.reports[0], ReportsViewModel.Verb.Unmute)
            model.reason("r3", "bann")
            advanceUntilIdle()
            model.act(
                model.state.value.reports
                    .single { it.reportId == "r3" },
                ReportsViewModel.Verb.Ban,
            )
            advanceUntilIdle()
            assertTrue("moderate k1 UNMUTE_MEMBER a2 aflétt r2" in social.calls)
            assertTrue("moderate k1 BAN_MEMBER a2 bann r3" in social.calls)
        }

    @Test
    fun anAccountReportActsOnTheAccountAndADeletedAuthorIsNotActedOn() {
        val account = report("r3", ReportTargetKind.ACCOUNT, "a9", author = null)
        assertEquals("a9", account.member())
        assertEquals(ModerationAction.UNBAN_MEMBER, account.action(ReportsViewModel.Verb.Unban))
        val orphan = report("r1", ReportTargetKind.POST, "p1", author = null)
        assertNull(orphan.member())
        assertNull(orphan.action(ReportsViewModel.Verb.Ban))
        assertEquals(ModerationAction.RESTORE_POST, orphan.action(ReportsViewModel.Verb.Restore))
    }

    @Test
    fun closedReportsAreShownAndRestoredWithoutNamingTheReport() =
        runTest(dispatcher) {
            social.reports.getValue("k1").add(report("r4", ReportTargetKind.COMMENT, "c1", state = ReportState.CLOSED))
            val model = model()
            assertEquals(
                listOf("r1", "r2", "r3"),
                model.state.value.reports
                    .map { it.reportId },
            )
            model.show(ReportState.CLOSED)
            advanceUntilIdle()
            assertTrue("communityReports k1 CLOSED" in social.calls)
            assertEquals(ReportState.CLOSED, model.state.value.showing)
            val closed =
                model.state.value.reports
                    .single()
            assertEquals("r4", closed.reportId)
            model.reason("r4", "mistök")
            model.act(closed, ReportsViewModel.Verb.Dismiss)
            advanceUntilIdle()
            assertFalse(social.calls.any { it.startsWith("closeReport") })
            model.act(closed, ReportsViewModel.Verb.Restore)
            advanceUntilIdle()
            assertTrue("moderate k1 RESTORE_COMMENT c1 mistök null" in social.calls)
        }

    @Test
    fun aVerbThatDoesNotApplyToTheTargetIsNotSent() =
        runTest(dispatcher) {
            social.reports["k1"] =
                mutableListOf(
                    report("r1", ReportTargetKind.POST, "p1", targetState = samtak.spjall.core.TargetState.REMOVED),
                )
            val model = model()
            model.reason("r1", "Því")
            model.act(model.state.value.reports[0], ReportsViewModel.Verb.Hide)
            advanceUntilIdle()
            assertFalse(social.calls.any { it.startsWith("moderate") })
            model.act(model.state.value.reports[0], ReportsViewModel.Verb.Restore)
            advanceUntilIdle()
            assertTrue(social.calls.any { it.startsWith("moderate k1 RESTORE_POST p1") })
        }

    @Test
    fun aClosedReportKeepsItsDecisionAndWhoClosedIt() =
        runTest(dispatcher) {
            social.reports["k1"] =
                mutableListOf(
                    report(
                        "r9",
                        ReportTargetKind.POST,
                        "p1",
                        state = ReportState.CLOSED,
                        decision = samtak.spjall.core.ReportDecision.HIDE_POST,
                        resolution = "Spam",
                        closedBy = self,
                        closedAt = 1_700_000_000_000uL,
                    ),
                )
            val model = model()
            model.show(ReportState.CLOSED)
            advanceUntilIdle()
            val closed =
                model.state.value.reports
                    .single()
            assertEquals(samtak.spjall.core.ReportDecision.HIDE_POST, closed.decision)
            assertEquals("Spam", closed.resolution)
            assertEquals(self, closed.closedBy)
        }
}
