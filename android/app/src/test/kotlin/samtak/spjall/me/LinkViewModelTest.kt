package samtak.spjall.me

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
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
import samtak.spjall.account.FakeAccount
import samtak.spjall.account.Problem
import samtak.spjall.account.unreachable
import samtak.spjall.brand.R
import samtak.spjall.core.CoreException
import samtak.spjall.core.LinkRequest
import samtak.spjall.me.link.LinkViewModel
import samtak.spjall.me.link.LinkViewModel.History
import samtak.spjall.me.link.LinkViewModel.Reason
import samtak.spjall.me.link.LinkViewModel.State

@OptIn(ExperimentalCoroutinesApi::class)
class LinkViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val account = FakeAccount(signedIn = true)
    private var clock = 1_800_000_000_000L

    @Before fun main() = Dispatchers.setMain(dispatcher)

    @After fun reset() = Dispatchers.resetMain()

    // The core's text check needs the native library, so the test says what a code looks like.
    private fun model() = LinkViewModel(account, isCode = { it.startsWith(CODE) }, now = { clock }, io = dispatcher)

    private fun inspected(): LinkViewModel =
        model().also {
            it.submit(CODE)
            dispatcher.scheduler.advanceUntilIdle()
        }

    @Test
    fun textThatIsNotACodeNeverReachesTheServer() =
        runTest(dispatcher) {
            val model = model()
            model.submit("https://elsewhere.test/")
            advanceUntilIdle()
            assertEquals(State.Refused(Reason.INVALID), model.state.value)
            assertTrue(account.calls.none { it.startsWith("inspectLink") })
        }

    @Test
    fun aCodeIsInspectedAndThenAwaitsApproval() =
        runTest(dispatcher) {
            val model = model()
            model.submit("  $CODE  ")
            assertEquals(State.Inspecting, model.state.value)
            advanceUntilIdle()
            assertEquals(State.Approve(account.linkRequest, History.RECENT), model.state.value)
            assertEquals(listOf("inspectLink $CODE"), account.calls)
        }

    @Test
    fun aSecondCodeWhileOneIsBeingCheckedIsDropped() =
        runTest(dispatcher) {
            val model = model()
            model.submit(CODE)
            model.submit("${CODE}2")
            advanceUntilIdle()
            assertEquals(listOf("inspectLink $CODE"), account.calls)
        }

    @Test
    fun aRequestApprovedBeforeIsRefusedWithoutOfferingApproval() =
        runTest(dispatcher) {
            account.linkRequest = LinkRequest("Firefox", "Linux", 1L, approved = true)
            val model = model()
            model.submit(CODE)
            advanceUntilIdle()
            assertEquals(State.Refused(Reason.ALREADY), model.state.value)
        }

    @Test
    fun eachRefusalHasItsOwnSentence() =
        runTest(dispatcher) {
            val cases =
                listOf<Pair<CoreException, Int>>(
                    CoreException.LinkCodeInvalid() to R.string.device_link_invalid,
                    CoreException.LinkKeyMismatch() to R.string.device_link_mismatch,
                    CoreException.LinkExpired() to R.string.device_link_expired,
                    CoreException.LinkAlreadyApproved() to R.string.device_link_already,
                )
            for ((error, text) in cases) {
                account.failNext = error
                val model = model()
                model.submit(CODE)
                advanceUntilIdle()
                val state = model.state.value as State.Refused
                assertEquals(text, state.reason.text)
            }
        }

    @Test
    fun aRefusalIsLeftByTryingAnotherCode() =
        runTest(dispatcher) {
            account.failNext = CoreException.LinkExpired()
            val model = model()
            model.submit(CODE)
            advanceUntilIdle()
            model.again()
            assertEquals(State.Scanning, model.state.value)
            model.submit(CODE)
            advanceUntilIdle()
            assertTrue(model.state.value is State.Approve)
        }

    @Test
    fun anUnreachableServerCanBeAskedAgain() =
        runTest(dispatcher) {
            account.failNext = unreachable()
            val model = model()
            model.submit(CODE)
            advanceUntilIdle()
            assertEquals(State.Failed(Problem.Unreachable), model.state.value)
            model.retry()
            advanceUntilIdle()
            assertTrue(model.state.value is State.Approve)
        }

    @Test
    fun recentSendsTheLastNinetyDays() =
        runTest(dispatcher) {
            val model = inspected()
            model.approve()
            assertEquals(State.Sending(History.RECENT), model.state.value)
            advanceUntilIdle()
            assertEquals(State.Done, model.state.value)
            val ninetyDays = 90L * 24 * 3600 * 1000
            assertEquals(listOf<Pair<ULong?, Boolean>>((clock - ninetyDays).toULong() to true), account.approvals)
        }

    @Test
    fun allSendsEverything() =
        runTest(dispatcher) {
            val model = inspected()
            model.choose(History.ALL)
            model.approve()
            advanceUntilIdle()
            assertEquals(listOf<Pair<ULong?, Boolean>>(null to true), account.approvals)
        }

    @Test
    fun noneSendsNoHistory() =
        runTest(dispatcher) {
            val model = inspected()
            model.choose(History.NONE)
            model.approve()
            advanceUntilIdle()
            assertEquals(State.Done, model.state.value)
            assertFalse(account.approvals.single().second)
        }

    @Test
    fun approvingTwiceApprovesOnce() =
        runTest(dispatcher) {
            val model = inspected()
            model.approve()
            model.approve()
            advanceUntilIdle()
            assertEquals(1, account.approvals.size)
        }

    @Test
    fun aRequestApprovedElsewhereMeanwhileIsRefused() =
        runTest(dispatcher) {
            val model = inspected()
            account.failNext = CoreException.LinkAlreadyApproved()
            model.approve()
            advanceUntilIdle()
            assertEquals(State.Refused(Reason.ALREADY), model.state.value)
        }

    @Test
    fun typingTheCodeAndGoingBackToTheCamera() {
        val model = model()
        model.paste()
        assertEquals(State.Pasting, model.state.value)
        model.scan()
        assertEquals(State.Scanning, model.state.value)
    }

    private companion object {
        // Not the core's format: only this test's isCode knows it.
        const val CODE = "link-test-code"
    }
}
