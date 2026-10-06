package samtak.spjall.me

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
import samtak.spjall.account.FakeAccount
import samtak.spjall.account.Problem
import samtak.spjall.account.unreachable

@OptIn(ExperimentalCoroutinesApi::class)
class MeViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val account = FakeAccount(signedIn = true)

    @Before fun main() = Dispatchers.setMain(dispatcher)

    @After fun reset() = Dispatchers.resetMain()

    private fun TestScope.model(): MeViewModel = MeViewModel(account, dispatcher).also { advanceUntilIdle() }

    @Test
    fun showsThePersonTheirDevicesAndNoLinkUntilAskedForOne() =
        runTest(dispatcher) {
            val model = model()
            val state = model.state.value
            assertEquals("Jón Jónsson", state.me?.name)
            assertEquals(listOf("d1", "d2"), state.me?.devices?.map { it.deviceId })
            assertNull(state.link)
            assertFalse("opening the screen must not end a shared link", "rotateInvite" in account.calls)
        }

    @Test
    fun showsTheLinkThisDeviceMadeBefore() =
        runTest(dispatcher) {
            account.link = "https://link.test/l/old"
            assertEquals("https://link.test/l/old", model().state.value.link)
        }

    @Test
    fun aNewLinkReplacesTheOldOne() =
        runTest(dispatcher) {
            val model = model()
            model.newLink()
            advanceUntilIdle()
            assertEquals("https://link.test/l/1", model.state.value.link)
            model.newLink()
            advanceUntilIdle()
            assertEquals("https://link.test/l/2", model.state.value.link)
        }

    @Test
    fun revokingAnotherDeviceRefreshesTheList() =
        runTest(dispatcher) {
            val model = model()
            model.revoke("d2")
            advanceUntilIdle()
            assertEquals(
                listOf("d1"),
                model.state.value.me
                    ?.devices
                    ?.map { it.deviceId },
            )
            assertFalse(model.state.value.signedOut)
        }

    @Test
    fun revokingThisDeviceSignsOut() =
        runTest(dispatcher) {
            val model = model()
            model.revoke("d1")
            advanceUntilIdle()
            assertTrue(model.state.value.signedOut)
            assertEquals("revokeDevice d1", account.calls.last())
        }

    @Test
    fun deletingTheAccountSignsOut() =
        runTest(dispatcher) {
            val model = model()
            model.deleteAccount()
            advanceUntilIdle()
            assertTrue(model.state.value.signedOut)
        }

    @Test
    fun aFailedActionCanBeTriedAgain() =
        runTest(dispatcher) {
            val model = model()
            account.failNext = unreachable()
            model.deleteAccount()
            advanceUntilIdle()
            assertEquals(Problem.Unreachable, model.state.value.problem)
            assertFalse(model.state.value.signedOut)

            model.retry()
            advanceUntilIdle()
            assertNull(model.state.value.problem)
            assertTrue(model.state.value.signedOut)
        }

    @Test
    fun aFailedFirstLoadCanBeTriedAgain() =
        runTest(dispatcher) {
            account.failNext = unreachable()
            val model = model()
            assertNull(model.state.value.me)
            model.retry()
            advanceUntilIdle()
            assertEquals(
                "a1",
                model.state.value.me
                    ?.accountId,
            )
        }
}
