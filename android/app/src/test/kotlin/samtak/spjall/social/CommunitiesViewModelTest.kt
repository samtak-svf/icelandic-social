package samtak.spjall.social

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
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
import samtak.spjall.core.CommunityRole

@OptIn(ExperimentalCoroutinesApi::class)
class CommunitiesViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val social = FakeSocial()
    private val account = FakeAccount(signedIn = true)

    @Before fun main() = Dispatchers.setMain(dispatcher)

    @After fun reset() = Dispatchers.resetMain()

    private fun TestScope.model() = CommunitiesViewModel(social, account, dispatcher).also { advanceUntilIdle() }

    @Test
    fun showsMineAndTheOthersOnce() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1", "Kórinn", role = CommunityRole.MEMBER)
            social.communities["k2"] = community("k2", "Skákfélagið")
            val state = model().state.value
            assertEquals(listOf("k1"), state.mine.map { it.communityId })
            assertEquals(listOf("k2"), state.others.map { it.communityId })
            assertTrue(state.loaded)
            assertTrue(state.verified)
        }

    @Test
    fun loadsTheCombinedFeedAlongsideTheCommunityLists() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1", role = CommunityRole.MEMBER)
            social.communities["k2"] = community("k2")
            social.posts["k1"] = mutableListOf(post("p1", communityId = "k1"))
            social.posts["k2"] = mutableListOf(post("p2", communityId = "k2"))
            val state = model().state.value
            assertEquals(listOf("p1"), state.feed.map { it.postId })
            assertTrue("feed 20" in social.calls)
            assertEquals(CommunitiesTab.MINE, state.tab)
        }

    @Test
    fun anUnverifiedAccountIsNotOfferedCreate() =
        runTest(dispatcher) {
            account.verified = false
            assertFalse(model().state.value.verified)
        }

    @Test
    fun aSearchWaitsForTypingToStopAndShowsEveryMatch() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1", "Kórinn", role = CommunityRole.MEMBER)
            social.communities["k2"] = community("k2", "Karlakórinn")
            val model = model()
            model.search("k")
            model.search("kór")
            advanceTimeBy(100)
            assertFalse(social.calls.any { it == "communities kór" })
            advanceUntilIdle()
            assertEquals(1, social.calls.count { it == "communities kór" })
            assertEquals(
                listOf("k1", "k2"),
                model.state.value.others
                    .map { it.communityId },
            )
        }

    @Test
    fun theNextPageIsAddedToTheSearch() =
        runTest(dispatcher) {
            social.pageSize = 1
            social.communities["k1"] = community("k1")
            social.communities["k2"] = community("k2")
            val model = model()
            assertEquals("1", model.state.value.next)
            model.more()
            advanceUntilIdle()
            assertEquals(
                listOf("k1", "k2"),
                model.state.value.others
                    .map { it.communityId },
            )
            assertNull(model.state.value.next)
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

    @Test
    fun pinnedCommunitiesLeadMine() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1", "Kórinn", role = CommunityRole.MEMBER)
            social.communities["k2"] = community("k2", "Skákfélagið", role = CommunityRole.MEMBER, pinned = true)
            assertEquals(
                listOf("k2", "k1"),
                model()
                    .state.value.mine
                    .map { it.communityId },
            )
        }

    @Test
    fun pinningMovesACommunityToTheTopAndUnpinningBack() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1", "Kórinn", role = CommunityRole.MEMBER)
            social.communities["k2"] = community("k2", "Skákfélagið", role = CommunityRole.MEMBER)
            val model = model()
            model.pin("k2", true)
            advanceUntilIdle()
            assertTrue("pinCommunity k2" in social.calls)
            assertEquals(
                "k2",
                model.state.value.mine
                    .first()
                    .communityId,
            )
            model.pin("k2", false)
            advanceUntilIdle()
            assertTrue("unpinCommunity k2" in social.calls)
            assertFalse(
                model.state.value.mine
                    .first { it.communityId == "k2" }
                    .pinned,
            )
        }

    @Test
    fun unreadPostsAreReadAgainWhenTheHubIsLoadedAgain() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1", role = CommunityRole.MEMBER, unread = 3uL)
            val model = model()
            assertEquals(
                3uL,
                model.state.value.mine
                    .single()
                    .unread,
            )
            // Opening the community cleared them on the server; the hub asks again on return.
            social.communities["k1"] = community("k1", role = CommunityRole.MEMBER, unread = 0uL)
            model.load()
            advanceUntilIdle()
            assertEquals(
                0uL,
                model.state.value.mine
                    .single()
                    .unread,
            )
        }
}
