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
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import samtak.spjall.account.FakeAccount
import samtak.spjall.account.Problem
import samtak.spjall.account.unreachable
import samtak.spjall.core.CoreException
import samtak.spjall.core.Focus
import samtak.spjall.core.FrameKind
import samtak.spjall.core.Framing
import samtak.spjall.core.Person
import samtak.spjall.core.Settings
import java.io.File
import java.io.IOException

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

    @Test
    fun theTogglesAreShownAndChanged() =
        runTest(dispatcher) {
            val model = model()
            assertEquals(Settings(readMarkers = true, typing = true), model.state.value.settings)
            model.readMarkers(false)
            advanceUntilIdle()
            model.typing(false)
            advanceUntilIdle()
            assertEquals(Settings(readMarkers = false, typing = false), model.state.value.settings)
            assertEquals(Settings(readMarkers = false, typing = false), account.current)
        }

    @Test
    fun theBlockedAreListedAndCanBeUnblocked() =
        runTest(dispatcher) {
            account.blockedPeople = mutableListOf(Person("a3", "Bjarni", false), Person("a2", "Anna", true))
            val model = model()
            assertEquals(
                listOf("a3", "a2"),
                model.state.value.blocked
                    .map { it.account },
            )
            model.unblock("a3")
            advanceUntilIdle()
            assertEquals(
                listOf("a2"),
                model.state.value.blocked
                    .map { it.account },
            )
            assertTrue("unblock a3" in account.calls)
        }

    private fun picked(bytes: ByteArray): File = File.createTempFile("photo", ".jpg").apply { writeBytes(bytes) }

    private val framing = Framing(Focus(0.25, 0.75), emptyList())

    @Test
    fun aChosenPhotoIsUploadedThenFramedShownAndItsFileDeleted() =
        runTest(dispatcher) {
            val model = model()
            assertNull(
                model.state.value.me
                    ?.photo,
            )
            val file = picked(byteArrayOf(1, 2, 3))
            val request = model.photoRequest { file }
            assertEquals(FrameKind.PHOTO, request.kind)
            assertEquals(file, request.master())
            request.save(framing)
            assertEquals(listOf(listOf<Byte>(1, 2, 3)), account.uploaded.map { it.toList() })
            val sent = account.calls.filter { it.startsWith("setPhoto") }
            assertEquals(listOf("setPhoto", "setPhotoFraming 0.25,0.75 0"), sent)
            assertEquals(
                "v2",
                model.state.value.me
                    ?.photo,
            )
            request.release(file, true)
            assertFalse("the master is not kept (decision 0086)", file.exists())
        }

    @Test
    fun aFailedUploadLeavesNothingSetAndTheSheetKeepsTheFile() =
        runTest(dispatcher) {
            val model = model()
            account.failOn = "setPhoto"
            val file = picked(byteArrayOf(1))
            val request = model.photoRequest { file }
            request.master()
            try {
                request.save(framing)
                fail("the upload should have failed")
            } catch (_: CoreException) {
                // The sheet shows the problem and Save tries again.
            }
            assertNull(
                model.state.value.me
                    ?.photo,
            )
            account.failOn = null
            request.save(framing)
            assertEquals(
                "v2",
                model.state.value.me
                    ?.photo,
            )
        }

    @Test
    fun aPickThatIsNotAPhotoFailsWhenTheSheetLoadsIt() =
        runTest(dispatcher) {
            val model = model()
            val request = model.photoRequest { throw IOException("not an image") }
            try {
                request.master()
                fail("reading should have failed")
            } catch (_: IOException) {
                // FrameSession turns this into the sheet's problem.
            }
            assertFalse("setPhoto" in account.calls)
        }

    @Test
    fun framingAgainFetchesTheMasterAndSendsOnlyTheFraming() =
        runTest(dispatcher) {
            account.myFraming = framing
            account.photoMaster = byteArrayOf(9)
            val model = model()
            val file = File.createTempFile("master", ".jpg")
            val request = model.reframePhotoRequest { file }
            assertEquals(framing, request.base())
            assertEquals(file, request.master())
            request.save(Framing(Focus(0.5, 0.5), emptyList()))
            assertFalse("setPhoto" in account.calls)
            assertTrue("setPhotoFraming 0.5,0.5 0" in account.calls)
            file.delete()
        }

    @Test
    fun aPhotoWithoutAMasterHasNothingToFrame() =
        runTest(dispatcher) {
            val model = model()
            val file = File.createTempFile("master", ".jpg")
            assertNull(model.reframePhotoRequest { file }.master())
            assertFalse("the empty file is removed", file.exists())
        }

    @Test
    fun aRemovedPhotoTellsTheWall() =
        runTest(dispatcher) {
            account.myPhoto = "v7"
            val model = model()
            var told = 0
            model.removePhoto { told++ }
            advanceUntilIdle()
            assertEquals(1, told)
        }

    @Test
    fun aFailedRemovalLandsInPhotoProblemAndTellsNoOne() =
        runTest(dispatcher) {
            account.myPhoto = "v7"
            val model = model()
            account.failOn = "removePhoto"
            var told = 0
            model.removePhoto { told++ }
            advanceUntilIdle()
            assertEquals(0, told)
            assertNotNull(model.state.value.photoProblem)
            assertNull(model.state.value.problem)
            account.failOn = null
            model.retry()
            advanceUntilIdle()
            assertEquals(1, told)
            assertNull(model.state.value.photoProblem)
        }

    @Test
    fun aChosenPhotoTellsTheWallOnceItIsIn() =
        runTest(dispatcher) {
            val model = model()
            val file = File.createTempFile("master", ".jpg")
            file.writeBytes(byteArrayOf(1))
            var told = 0
            val request = model.photoRequest({ told++ }) { file }
            request.master()
            request.save(framing)
            assertEquals(1, told)
        }

    @Test
    fun aFramedPhotoTellsTheWallOnceItIsIn() =
        runTest(dispatcher) {
            account.myFraming = framing
            account.photoMaster = byteArrayOf(9)
            val model = model()
            val file = File.createTempFile("master", ".jpg")
            var told = 0
            model.reframePhotoRequest({ told++ }) { file }.save(framing)
            assertEquals(1, told)
        }

    @Test
    fun removingThePhotoClearsIt() =
        runTest(dispatcher) {
            account.myPhoto = "v7"
            val model = model()
            assertEquals(
                "v7",
                model.state.value.me
                    ?.photo,
            )
            model.removePhoto()
            advanceUntilIdle()
            assertTrue("removePhoto" in account.calls)
            assertNull(
                model.state.value.me
                    ?.photo,
            )
        }
}
