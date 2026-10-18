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
import samtak.spjall.core.SocialNotificationKind

@OptIn(ExperimentalCoroutinesApi::class)
class NotificationsViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val social = FakeSocial()
    private var reads = 0

    @Before fun main() = Dispatchers.setMain(dispatcher)

    @After fun reset() = Dispatchers.resetMain()

    private fun TestScope.model() =
        NotificationsViewModel(social, { reads++ }, dispatcher).also {
            it.load()
            advanceUntilIdle()
        }

    @Test
    fun showingTheListReadsUpToTheNewest() =
        runTest(dispatcher) {
            social.notifications =
                listOf(
                    notification("n2", SocialNotificationKind.REACTION, 20uL),
                    notification("n1", SocialNotificationKind.COMMENT, 10uL),
                )
            val model = model()
            assertEquals(
                listOf("n2", "n1"),
                model.state.value.notifications
                    .map { it.notificationId },
            )
            assertTrue(
                model.state.value.notifications
                    .none { it.read },
            )
            assertTrue("readNotifications 20" in social.calls)
            assertEquals(1, reads)
        }

    @Test
    fun nothingUnreadIsNotReadAgain() =
        runTest(dispatcher) {
            social.notifications = listOf(notification("n1", SocialNotificationKind.COMMENT, 10uL))
            social.readUpTo = 10uL
            model()
            assertFalse(social.calls.any { it.startsWith("readNotifications") })
            assertEquals(0, reads)
        }

    @Test
    fun anEmptyListReadsNothing() =
        runTest(dispatcher) {
            val model = model()
            assertTrue(model.state.value.loaded)
            assertFalse(social.calls.any { it.startsWith("readNotifications") })
        }

    @Test
    fun aTapOpensThePostOrTheCommunity() {
        assertEquals(Opens.Post("p1"), notification("n", SocialNotificationKind.COMMENT, 1uL).opens())
        assertEquals(Opens.Post("p1"), notification("n", SocialNotificationKind.REACTION, 1uL).opens())
        assertEquals(Opens.Community("k1"), notification("n", SocialNotificationKind.MODERATED, 1uL).opens())
        assertEquals(
            Opens.Community("k1"),
            notification("n", SocialNotificationKind.JOIN_APPROVED, 1uL, postId = null).opens(),
        )
    }

    @Test
    fun aFailedLoadCanBeTriedAgain() =
        runTest(dispatcher) {
            social.failNext = unreachable()
            val model = model()
            assertEquals(Problem.Unreachable, model.state.value.problem)
            model.retry()
            advanceUntilIdle()
            assertNull(model.state.value.problem)
        }
}
