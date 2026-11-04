package samtak.spjall.social

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import samtak.spjall.account.unreachable
import samtak.spjall.core.Relation
import samtak.spjall.core.SocialNotificationKind

@OptIn(ExperimentalCoroutinesApi::class)
class UnreadViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val social = FakeSocial()

    @Before fun main() = Dispatchers.setMain(dispatcher)

    @After fun reset() = Dispatchers.resetMain()

    @Test
    fun countsTheUnseenAndKeepsTheCountWhenAskingFails() =
        runTest(dispatcher) {
            social.notifications =
                listOf(
                    notification("n2", SocialNotificationKind.REACTION, 20uL),
                    notification("n1", SocialNotificationKind.COMMENT, 10uL),
                )
            val model = UnreadViewModel(social, dispatcher)
            model.refresh()
            advanceUntilIdle()
            assertEquals(2L, model.count.value)
            assertTrue("notifications 1" in social.calls)
            social.failNext = unreachable()
            model.refresh()
            advanceUntilIdle()
            assertEquals(2L, model.count.value)
            // Reading nothing but seeing the list clears the badge (0104); the rows stay unread.
            social.seenUpTo = 20uL
            model.refresh()
            advanceUntilIdle()
            assertEquals(0L, model.count.value)
            assertTrue(social.notifications.isNotEmpty())
        }

    @Test
    fun asksAgainWhenAnActionEndedANotice() =
        runTest(dispatcher) {
            social.notifications = listOf(notification("n1", SocialNotificationKind.COMMENT, 10uL))
            val changes = NoticeChanges()
            val model = UnreadViewModel(social, dispatcher, changes.changed)
            advanceUntilIdle()
            social.notifications = emptyList()
            changes.announce()
            advanceUntilIdle()
            assertEquals(0L, model.count.value)
            assertTrue("notifications 1" in social.calls)
        }

    @Test
    fun announcesAfterEachCallThatEndsANoticeAndOnlyWhenItSucceeded() =
        runTest(dispatcher) {
            val changes = NoticeChanges()
            val announced = mutableListOf<Unit>()
            val job = launch(UnconfinedTestDispatcher(testScheduler)) { changes.changed.collect { announced.add(it) } }
            val noticing = NoticingSocial(social, changes)
            social.communities["k1"] = community("k1").copy(invited = true)
            social.people["a1"] = profile(anna, Relation.INCOMING)
            noticing.joinCommunity("k1")
            noticing.withdrawJoinRequest("k1")
            noticing.acceptFriendRequest("a1")
            noticing.declineFriendRequest("a1")
            assertEquals(4, announced.size)
            social.failNext = unreachable()
            runCatching { noticing.declineFriendRequest("a1") }
            assertEquals(4, announced.size)
            job.cancel()
        }
}
