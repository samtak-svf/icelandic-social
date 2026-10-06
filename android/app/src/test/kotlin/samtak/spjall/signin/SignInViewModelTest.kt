package samtak.spjall.signin

import androidx.lifecycle.SavedStateHandle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import samtak.spjall.account.FakeAccount
import samtak.spjall.account.Problem
import samtak.spjall.account.unreachable
import samtak.spjall.core.CoreException
import samtak.spjall.core.Inviter
import samtak.spjall.signin.SignInViewModel.Invite
import samtak.spjall.signin.SignInViewModel.Session

@OptIn(ExperimentalCoroutinesApi::class)
class SignInViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val account = FakeAccount()
    private val saved = SavedStateHandle()

    @Before fun main() = Dispatchers.setMain(dispatcher)

    @After fun reset() = Dispatchers.resetMain()

    private fun TestScope.model(): SignInViewModel =
        SignInViewModel(account, saved, dispatcher).also { advanceUntilIdle() }

    @Test
    fun aSignedInDeviceGoesStraightInAndTopsUpItsKeyPackages() =
        runTest(dispatcher) {
            account.signedIn = true
            val model = model()
            assertEquals(Session.SignedIn, model.state.value.session)
            assertEquals(listOf("signedIn", "stockKeyPackages"), account.calls)
        }

    @Test
    fun anInviteNamesTheInviterAndItsTokenGoesWithTheSignIn() =
        runTest(dispatcher) {
            account.inviters = mapOf("t1" to Inviter("Anna", true))
            val model = model()
            model.openInvite("t1")
            advanceUntilIdle()
            assertEquals(Invite.From("Anna"), model.state.value.invite)

            model.signIn()
            assertEquals(FakeAccount.KENNI, model.browser.first())
            model.complete("cb1")
            advanceUntilIdle()
            assertEquals(Session.SignedIn, model.state.value.session)
            assertEquals("completeSignIn cb1 t1", account.calls.single { it.startsWith("complete") })
        }

    @Test
    fun theOperatorsInviteHasNoName() =
        runTest(dispatcher) {
            account.inviters = mapOf("t1" to null)
            val model = model()
            model.openInvite("t1")
            advanceUntilIdle()
            assertEquals(Invite.From(null), model.state.value.invite)
        }

    @Test
    fun aDeadLinkSaysSo() =
        runTest(dispatcher) {
            val model = model()
            model.openInvite("gone")
            advanceUntilIdle()
            assertEquals(Invite.Expired, model.state.value.invite)
        }

    @Test
    fun anUnreachableServerDoesNotMakeALinkDead() =
        runTest(dispatcher) {
            val model = model()
            account.failNext = unreachable()
            model.openInvite("t1")
            advanceUntilIdle()
            assertEquals(Invite.From(null), model.state.value.invite)
        }

    @Test
    fun anUnreachableServerLeavesTheCallbackToTryAgain() =
        runTest(dispatcher) {
            val model = model()
            account.failNext = unreachable()
            model.complete("cb1")
            advanceUntilIdle()
            assertEquals(Session.SignedOut, model.state.value.session)
            assertEquals(Problem.Unreachable, model.state.value.problem)

            model.retry()
            advanceUntilIdle()
            assertEquals(Session.SignedIn, model.state.value.session)
            assertNull(model.state.value.problem)
            assertEquals(2, account.calls.count { it == "completeSignIn cb1 -" })
        }

    @Test
    fun anyOtherFailureEndsTheSignInSoRetryingStartsANewOne() =
        runTest(dispatcher) {
            val model = model()
            account.failNext = CoreException.SignIn("state mismatch")
            model.complete("cb1")
            advanceUntilIdle()
            assertEquals(Problem.Generic, model.state.value.problem)

            model.retry()
            advanceUntilIdle()
            assertEquals(FakeAccount.KENNI, model.browser.first())
            assertEquals("beginSignIn", account.calls.last())
        }

    @Test
    fun withoutAnInviteANewPersonIsToldTheyNeedOne() =
        runTest(dispatcher) {
            val model = model()
            account.failNext = CoreException.Refused(403u, "invite_required")
            model.complete("cb1")
            advanceUntilIdle()
            assertEquals(Problem.InviteRequired, model.state.value.problem)
        }

    @Test
    fun theInviteAndCallbackSurviveTheProcessEnding() =
        runTest(dispatcher) {
            account.inviters = mapOf("t1" to Inviter("Anna", true))
            account.failNext = null
            saved["invite"] = "t1"
            saved["callback"] = "cb1"
            val model = model()
            assertEquals(Session.SignedIn, model.state.value.session)
            assertEquals("completeSignIn cb1 t1", account.calls.single { it.startsWith("complete") })
        }

    @Test
    fun aCallbackBeforeTheFirstCheckIsNotUndoneByIt() =
        runTest(dispatcher) {
            val model = SignInViewModel(account, saved, dispatcher)
            model.complete("cb1")
            advanceUntilIdle()
            assertEquals(Session.SignedIn, model.state.value.session)
        }

    @Test
    fun signingOutStartsOverWithAFreshScreenNextTime() =
        runTest(dispatcher) {
            account.signedIn = true
            val model = model()
            model.signedOut()
            assertEquals(Session.SignedOut, model.state.value.session)
            model.complete("cb2")
            advanceUntilIdle()
            assertEquals(2, model.state.value.signIns)
        }
}
