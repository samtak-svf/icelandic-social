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
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import samtak.spjall.account.unreachable
import samtak.spjall.core.CommunityRole
import samtak.spjall.core.NotificationLevel
import samtak.spjall.core.SocialNotificationKind

@OptIn(ExperimentalCoroutinesApi::class)
class NotificationSettingsViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val social = FakeSocial()

    @Before fun main() = Dispatchers.setMain(dispatcher)

    @After fun reset() = Dispatchers.resetMain()

    private fun TestScope.model() =
        NotificationSettingsViewModel(social, dispatcher).also {
            it.load()
            advanceUntilIdle()
        }

    @Test
    fun everyKindStartsAtPushAndAnUnstoredCommunityReadsAsPush() =
        runTest(dispatcher) {
            social.communities["c1"] = community("c1", role = CommunityRole.MEMBER)
            val state = model().state.value
            assertTrue(state.loaded)
            assertTrue(SocialNotificationKind.entries.all { state.kind(it) == NotificationLevel.PUSH })
            assertEquals(NotificationLevel.PUSH, state.community("c1"))
        }

    @Test
    fun aChangedKindCallsTheCore() =
        runTest(dispatcher) {
            val model = model()
            model.setKind(SocialNotificationKind.REACTION, NotificationLevel.IN_APP)
            advanceUntilIdle()
            assertEquals(NotificationLevel.IN_APP, model.state.value.kind(SocialNotificationKind.REACTION))
            assertTrue("setNotificationSettings REACTION=IN_APP" in social.calls)
        }

    @Test
    fun aModeratorsNoticeOffersOnlyPushAndInAppAndRefusesOff() =
        runTest(dispatcher) {
            assertEquals(
                listOf(NotificationLevel.PUSH, NotificationLevel.IN_APP),
                allowedLevels(SocialNotificationKind.MODERATED),
            )
            assertEquals(3, allowedLevels(SocialNotificationKind.COMMENT).size)
            val model = model()
            model.setKind(SocialNotificationKind.MODERATED, NotificationLevel.OFF)
            advanceUntilIdle()
            assertEquals(NotificationLevel.PUSH, model.state.value.kind(SocialNotificationKind.MODERATED))
            assertFalse(social.calls.any { it.startsWith("setNotificationSettings") })
        }

    @Test
    fun aChangedCommunityCallsTheCoreAndKeepsItsName() =
        runTest(dispatcher) {
            social.communities["c1"] = community("c1", name = "Kórinn", role = CommunityRole.MEMBER)
            val model = model()
            model.setCommunity("c1", NotificationLevel.OFF)
            advanceUntilIdle()
            assertEquals(NotificationLevel.OFF, model.state.value.community("c1"))
            assertTrue("setCommunityNotificationLevel c1 OFF" in social.calls)
            assertEquals(
                "Kórinn",
                model.state.value
                    .rows()
                    .single()
                    .name,
            )
        }

    @Test
    fun aFailedChangeIsPutBack() =
        runTest(dispatcher) {
            val model = model()
            social.failNext = unreachable()
            model.setKind(SocialNotificationKind.COMMENT, NotificationLevel.OFF)
            advanceUntilIdle()
            assertEquals(NotificationLevel.PUSH, model.state.value.kind(SocialNotificationKind.COMMENT))
            assertNotNull(model.state.value.problem)
        }
}
