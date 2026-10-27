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
import samtak.spjall.core.NotificationLevel
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

    private val two =
        listOf(
            notification("n2", SocialNotificationKind.REACTION, 20uL),
            notification("n1", SocialNotificationKind.COMMENT, 10uL),
        )

    @Test
    fun showingTheListMarksItSeenAndReadsNothing() =
        runTest(dispatcher) {
            social.notifications = two
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
            assertTrue("seenNotifications 20" in social.calls)
            assertFalse(social.calls.any { it.startsWith("readNotification") })
            assertEquals(1, reads)
        }

    @Test
    fun nothingNewIsNotSeenAgain() =
        runTest(dispatcher) {
            social.notifications = two
            social.seenUpTo = 20uL
            model()
            assertFalse(social.calls.any { it.startsWith("seenNotifications") })
            assertEquals(0, reads)
        }

    @Test
    fun anEmptyListSeesNothing() =
        runTest(dispatcher) {
            val model = model()
            assertTrue(model.state.value.loaded)
            assertFalse(social.calls.any { it.startsWith("seenNotifications") })
        }

    @Test
    fun everyRowIsNewWhenTheListWasNeverSeen() =
        runTest(dispatcher) {
            social.notifications = two
            val (new, earlier) = model().state.value.sections
            assertEquals(2, new.size)
            assertTrue(earlier.isEmpty())
        }

    @Test
    fun rowsAfterTheLastSeenAreNewAndTheRestEarlier() =
        runTest(dispatcher) {
            social.notifications = two
            social.seenUpTo = 10uL
            val state = model().state.value
            assertEquals(10uL, state.seenAt)
            val (new, earlier) = state.sections
            assertEquals(listOf("n2"), new.map { it.notificationId })
            assertEquals(listOf("n1"), earlier.map { it.notificationId })
        }

    @Test
    fun openingARowReadsIt() =
        runTest(dispatcher) {
            social.notifications = two
            val dismissed = mutableListOf<String>()
            val model = NotificationsViewModel(social, { reads++ }, dispatcher) { dismissed += it }
            model.load()
            advanceUntilIdle()
            model.opened(
                model.state.value.notifications
                    .first(),
            )
            advanceUntilIdle()
            assertTrue("readNotification n2 true" in social.calls)
            assertEquals(
                listOf(true, false),
                model.state.value.notifications
                    .map { it.read },
            )
            assertEquals(listOf("n2"), dismissed)
        }

    @Test
    fun markAllReadReadsUpToTheNewest() =
        runTest(dispatcher) {
            social.notifications = two
            val model = model()
            model.markAllRead()
            advanceUntilIdle()
            assertTrue("readNotifications 20" in social.calls)
            assertTrue(
                model.state.value.notifications
                    .all { it.read },
            )
        }

    @Test
    fun theMenuMarksARowReadAndUnread() =
        runTest(dispatcher) {
            social.notifications = two
            val model = model()
            model.setRead(model.state.value.notifications[1], true)
            advanceUntilIdle()
            model.setRead(model.state.value.notifications[1], false)
            advanceUntilIdle()
            assertTrue("readNotification n1 true" in social.calls)
            assertTrue("readNotification n1 false" in social.calls)
            assertFalse(
                model.state.value.notifications[1]
                    .read,
            )
        }

    @Test
    fun theMenuRemovesARow() =
        runTest(dispatcher) {
            social.notifications = two
            val model = model()
            model.remove(
                model.state.value.notifications
                    .first(),
            )
            advanceUntilIdle()
            assertTrue("deleteNotification n2" in social.calls)
            assertEquals(
                listOf("n1"),
                model.state.value.notifications
                    .map { it.notificationId },
            )
        }

    @Test
    fun aFailedRemoveBringsTheRowBack() =
        runTest(dispatcher) {
            social.notifications = two
            val model = model()
            social.failNext = unreachable()
            model.remove(
                model.state.value.notifications
                    .first(),
            )
            advanceUntilIdle()
            assertEquals(2, model.state.value.notifications.size)
            assertEquals(Problem.Unreachable, model.state.value.problem)
        }

    @Test
    fun theMenuLowersAKindToInApp() =
        runTest(dispatcher) {
            social.notifications = two
            val model = model()
            model.kindInApp(
                model.state.value.notifications
                    .first(),
            )
            advanceUntilIdle()
            assertEquals(NotificationLevel.IN_APP, social.kindLevels[SocialNotificationKind.REACTION])
        }

    @Test
    fun aKindThatIsOffStaysOff() =
        runTest(dispatcher) {
            social.notifications = two
            social.kindLevels[SocialNotificationKind.REACTION] = NotificationLevel.OFF
            val model = model()
            model.kindInApp(
                model.state.value.notifications
                    .first(),
            )
            advanceUntilIdle()
            assertEquals(NotificationLevel.OFF, social.kindLevels[SocialNotificationKind.REACTION])
            assertFalse(social.calls.any { it.startsWith("setNotificationSettings") })
        }

    @Test
    fun theMenuTurnsACommunityOff() =
        runTest(dispatcher) {
            social.notifications = two
            val model = model()
            model.communityOff(
                model.state.value.notifications
                    .first(),
            )
            advanceUntilIdle()
            assertEquals(NotificationLevel.OFF, social.communityLevels["k1"])
        }

    @Test
    fun aModerationNoticeCannotBeSilenced() =
        runTest(dispatcher) {
            social.notifications = listOf(notification("m", SocialNotificationKind.MODERATED, 5uL))
            val model = model()
            model.kindInApp(
                model.state.value.notifications
                    .first(),
            )
            model.communityOff(
                model.state.value.notifications
                    .first(),
            )
            advanceUntilIdle()
            assertFalse(social.calls.any { it.startsWith("setNotificationSettings") || it.startsWith("setCommunity") })
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
