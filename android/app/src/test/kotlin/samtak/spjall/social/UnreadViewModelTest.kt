package samtak.spjall.social

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
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
import samtak.spjall.core.SocialNotificationKind

@OptIn(ExperimentalCoroutinesApi::class)
class UnreadViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val social = FakeSocial()

    @Before fun main() = Dispatchers.setMain(dispatcher)

    @After fun reset() = Dispatchers.resetMain()

    @Test
    fun countsTheUnreadAndKeepsTheCountWhenAskingFails() =
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
            social.readUpTo = 20uL
            model.refresh()
            advanceUntilIdle()
            assertEquals(0L, model.count.value)
        }
}
