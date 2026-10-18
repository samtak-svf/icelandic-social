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

    private fun TestScope.model() = ReportsViewModel("k1", social, dispatcher).also { advanceUntilIdle() }

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
}
