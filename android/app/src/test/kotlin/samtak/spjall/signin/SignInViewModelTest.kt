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
import kotlinx.coroutines.withTimeoutOrNull
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import samtak.spjall.account.FakeAccount
import samtak.spjall.account.Problem
import samtak.spjall.account.unreachable
import samtak.spjall.core.CoreException
import samtak.spjall.core.Inviter
import samtak.spjall.core.SignInProvider
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
            account.inviters = mapOf("t1" to Inviter("a1", "Anna", true))
            val model = model()
            model.openInvite("t1")
            advanceUntilIdle()
            assertEquals(Invite.From("Anna"), model.state.value.invite)

            model.signIn(SignInProvider.GOOGLE)
            assertEquals(FakeAccount.GOOGLE, model.browser.first())
            model.complete("cb1")
            advanceUntilIdle()
            assertEquals(Session.SignedIn, model.state.value.session)
            assertEquals("completeSignIn cb1 t1", account.calls.single { it.startsWith("complete") })
            // The link that let the person in also opens its 1:1.
            assertEquals(SignInViewModel.Link("t1", signedUp = true), model.invites.first())
        }

    @Test
    fun anInviteOpenedWhileSignedInGoesToTheList() =
        runTest(dispatcher) {
            account.signedIn = true
            val model = model()
            model.openInvite("t2")
            assertEquals(SignInViewModel.Link("t2", signedUp = false), model.invites.first())
            assertEquals(Invite.None, model.state.value.invite)
            assertEquals(listOf("signedIn", "stockKeyPackages"), account.calls)
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
    fun eachButtonOpensItsProvider() =
        runTest(dispatcher) {
            val model = model()
            model.signIn(SignInProvider.KENNI)
            assertEquals(FakeAccount.KENNI, model.browser.first())
            model.signIn(SignInProvider.GOOGLE)
            assertEquals(FakeAccount.GOOGLE, model.browser.first())
            assertEquals(listOf("beginSignIn KENNI", "beginSignIn GOOGLE"), account.calls.drop(1))
        }

    @Test
    fun anyOtherFailureEndsTheSignInSoRetryingStartsANewOneWithTheSameProvider() =
        runTest(dispatcher) {
            val model = model()
            model.signIn(SignInProvider.KENNI)
            model.browser.first()
            account.failNext = CoreException.SignIn("state mismatch")
            model.complete("cb1")
            advanceUntilIdle()
            assertEquals(Problem.Generic, model.state.value.problem)

            model.retry()
            advanceUntilIdle()
            assertEquals(FakeAccount.KENNI, model.browser.first())
            assertEquals("beginSignIn KENNI", account.calls.last())
        }

    @Test
    fun signedInTheRedirectLinksKenniInsteadOfSigningIn() =
        runTest(dispatcher) {
            account.signedIn = true
            account.verified = false
            val model = model()
            model.verify()
            assertEquals(FakeAccount.KENNI, model.browser.first())
            model.complete("cb1")
            advanceUntilIdle()
            model.linked.first()
            assertEquals(listOf("beginLink KENNI", "completeLink cb1"), account.calls.drop(2))
            assertEquals(Session.SignedIn, model.state.value.session)
            assertNull(model.state.value.problem)
        }

    @Test
    fun aSignInToAnAccountWithoutTheMarkOffersKenniOnce() =
        runTest(dispatcher) {
            account.verified = false
            val model = model()
            model.signIn(SignInProvider.GOOGLE)
            model.complete("cb1")
            advanceUntilIdle()
            model.offers.first()
            assertNull(withTimeoutOrNull(1_000) { model.offers.first() })
        }

    @Test
    fun aSignInToAVerifiedAccountOffersNothing() =
        runTest(dispatcher) {
            val model = model()
            model.signIn(SignInProvider.GOOGLE)
            model.complete("cb1")
            advanceUntilIdle()
            assertEquals(Session.SignedIn, model.state.value.session)
            assertNull(withTimeoutOrNull(1_000) { model.offers.first() })
        }

    @Test
    fun aLinkThatJoinsTheOlderAccountStartsTheSessionAgain() =
        runTest(dispatcher) {
            account.signedIn = true
            account.verified = false
            account.joins = true
            val model = model()
            val before = model.state.value.signIns
            model.verify()
            model.browser.first()
            model.complete("cb1")
            advanceUntilIdle()
            assertEquals(Session.SignedIn, model.state.value.session)
            assertEquals(before + 1, model.state.value.signIns)
            assertFalse(model.state.value.busy)
            assertNull(saved.get<String>("callback"))
        }

    @Test
    fun aKennitalaOnAnotherAccountIsSaidAndEndsTheLink() =
        runTest(dispatcher) {
            account.signedIn = true
            val model = model()
            account.failNext = CoreException.Refused(409u, "identity_taken")
            model.complete("cb1")
            advanceUntilIdle()
            assertEquals(Problem.IdentityTaken, model.state.value.problem)

            // The callback is spent: trying again opens Kenni anew.
            model.retry()
            assertEquals(FakeAccount.KENNI, model.browser.first())
            assertEquals("beginLink KENNI", account.calls.last())
            assertNull(model.state.value.problem)
        }

    @Test
    fun aLinkTheProcessEndedInTheMiddleOfIsFinished() =
        runTest(dispatcher) {
            account.signedIn = true
            saved["callback"] = "cb1"
            val model = model()
            model.linked.first()
            assertEquals("completeLink cb1", account.calls.last())
            assertNull(saved.get<String>("callback"))
        }

    @Test
    fun theInviteAndCallbackSurviveTheProcessEnding() =
        runTest(dispatcher) {
            account.inviters = mapOf("t1" to Inviter("a1", "Anna", true))
            account.failNext = null
            saved["invite"] = "t1"
            saved["callback"] = "cb1"
            val model = model()
            assertEquals(Session.SignedIn, model.state.value.session)
            assertEquals("completeSignIn cb1 t1", account.calls.single { it.startsWith("complete") })
            // The link that let the person in also opens its 1:1.
            assertEquals(SignInViewModel.Link("t1", signedUp = true), model.invites.first())
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
