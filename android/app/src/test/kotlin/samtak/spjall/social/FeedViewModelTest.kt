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
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import samtak.spjall.core.CommunityRole
import samtak.spjall.core.HomePage
import samtak.spjall.core.Poll
import samtak.spjall.core.PollOption
import samtak.spjall.core.Post
import samtak.spjall.core.PostTarget
import samtak.spjall.core.WallAudience

@OptIn(ExperimentalCoroutinesApi::class)
class FeedViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val social = FakeSocial()
    private val wall = PostTarget.Wall(WallAudience.FRIENDS)

    @Before fun main() = Dispatchers.setMain(dispatcher)

    @After fun reset() = Dispatchers.resetMain()

    private fun TestScope.model() = FeedViewModel(social, dispatcher) { wall }.also { advanceUntilIdle() }

    private fun FeedViewModel.ids(): List<String> =
        state.value.posts
            .map { it.postId }

    private fun FeedViewModel.headingOf(post: Post): String? =
        state.value
            .community(post)
            ?.communityId

    private fun homeCalls() = social.calls.count { it.startsWith("home") }

    @Test
    fun readsTheFirstPageAndKeepsTheCursor() =
        runTest(dispatcher) {
            social.homePages += HomePage.More(listOf(post("p1")), "c1")
            val model = model()
            assertEquals(listOf("p1"), model.ids())
            assertEquals("c1", model.state.value.next)
            assertEquals(FeedPhase.LIST, model.state.value.phase)
        }

    @Test
    fun anEndWithNoPostsIsTheOnlyEmptyFeed() =
        runTest(dispatcher) {
            val model = model()
            assertEquals(FeedPhase.EMPTY, model.state.value.phase)
        }

    @Test
    fun emptyPagesWithACursorAreNotAnEmptyFeedAndAreBoundedPerGo() =
        runTest(dispatcher) {
            repeat(20) { social.homePages += HomePage.More(emptyList(), "c$it") }
            social.homePages += HomePage.End(listOf(post("p9")))
            val model = model()
            assertEquals("eight empty pages in one go", 8, homeCalls())
            assertEquals(FeedPhase.LOADING, model.state.value.phase)
            assertNotNull(model.state.value.next)
            model.more()
            advanceUntilIdle()
            assertEquals("the next go is eight more", 16, homeCalls())
            assertEquals(FeedPhase.LOADING, model.state.value.phase)
            model.more()
            advanceUntilIdle()
            assertEquals(FeedPhase.LIST, model.state.value.phase)
            assertNull(model.state.value.next)
        }

    @Test
    fun aPageAsksForThirtyPosts() =
        runTest(dispatcher) {
            model()
            assertEquals(listOf(30u), social.limits)
        }

    @Test
    fun aPagingRequestMadeDuringAPublishGoesOutWhenItIsDone() =
        runTest(dispatcher) {
            social.homePages += HomePage.More(listOf(post("p1")), "c1")
            social.homePages += HomePage.End(listOf(post("p2")))
            val model = model()
            model.onDraft("Halló")
            model.publish()
            model.more()
            advanceUntilIdle()
            assertTrue("home c1" in social.calls)
            assertEquals(listOf("n1", "p1", "p2"), model.ids())
        }

    @Test
    fun aFailedCallDoesNotFireTheSkippedPagingRequest() =
        runTest(dispatcher) {
            social.homePages += HomePage.More(listOf(post("p1")), "c1")
            val model = model()
            social.failOn = "postTo"
            model.onDraft("Halló")
            model.publish()
            model.more()
            advanceUntilIdle()
            assertFalse("home c1" in social.calls)
            assertNotNull(model.state.value.problem)
            assertEquals(1, homeCalls())
        }

    @Test
    fun aFailedRefreshKeepsTheListAndSaysWhatWentWrong() =
        runTest(dispatcher) {
            social.homePages += HomePage.More(listOf(post("p1")), "c1")
            val model = model()
            social.failOn = "home"
            model.refresh()
            advanceUntilIdle()
            assertEquals(listOf("p1"), model.ids())
            assertNotNull(model.state.value.problem)
            assertFalse(model.state.value.refreshing)
            assertEquals(FeedPhase.LIST, model.state.value.phase)
        }

    @Test
    fun nothingIsReadAgainUnlessAskedFor() =
        runTest(dispatcher) {
            social.homePages += HomePage.More(listOf(post("p1")), "c1")
            model()
            advanceUntilIdle()
            assertEquals(1, homeCalls())
        }

    @Test
    fun publishingPutsThePostFirstClearsTheDraftAndWritesToTheTarget() =
        runTest(dispatcher) {
            social.homePages += HomePage.End(listOf(post("p1")))
            social.offered += community("k1", role = CommunityRole.MEMBER)
            val model = model()
            val community = PostTarget.Community("k1", anonymous = true)
            social.offered += community("k1", role = CommunityRole.MEMBER)
            model.onTarget(community)
            model.onDraft("Halló")
            model.publish()
            advanceUntilIdle()
            assertEquals(listOf("n1", "p1"), model.ids())
            assertEquals("", model.state.value.draft)
            assertEquals(community, social.written.single().target)
        }

    @Test
    fun deletingAPostDropsItFromTheList() =
        runTest(dispatcher) {
            social.homePages += HomePage.End(listOf(post("p1"), post("p2")))
            val model = model()
            model.deletePost("p1")
            advanceUntilIdle()
            assertEquals(listOf("p2"), model.ids())
            assertTrue("deletePost p1" in social.calls)
        }

    @Test
    fun aWallPostHasNoCommunityHeading() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1", role = CommunityRole.MEMBER)
            val wallPost =
                post("p2")
                    .copy(wallOwner = "a2")
            social.homePages += HomePage.End(listOf(post("p1"), wallPost))
            val model = model()
            val (inCommunity, onWall) = model.state.value.posts
            assertEquals("k1", model.headingOf(inCommunity))
            assertNull(model.headingOf(onWall))
        }

    @Test
    fun aCommunityThePickerLeavesOutStillNamesItsPostsAndRules() =
        runTest(dispatcher) {
            // Muted: not offered to the composer, yet a member, so the heading reads from the account's list.
            social.communities["k1"] = community("k1", role = CommunityRole.MEMBER, mutedUntil = FAR)
            social.homePages += HomePage.End(listOf(post("p1")))
            val model = model()
            val state = model.state.value
            assertTrue(state.communities.isEmpty())
            assertEquals("k1", model.headingOf(state.posts.single()))
        }

    @Test
    fun aMutedCommunityIsReadAndNotReactedToNorVotedIn() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1", role = CommunityRole.MEMBER, mutedUntil = FAR)
            social.communities["k2"] = community("k2", role = CommunityRole.MEMBER)
            social.homePages += HomePage.End(listOf(post("p1"), post("p2", communityId = "k2"), wallPost("p3")))
            val model = model()
            model.react("p1", "👍")
            model.vote("p1", "o0")
            advanceUntilIdle()
            assertTrue(social.calls.none { it.contains("p1") && (it.startsWith("react") || it.startsWith("votePoll")) })
            model.react("p2", "👍")
            model.react("p3", "👍")
            model.vote("p3", "o0")
            advanceUntilIdle()
            assertTrue("react p2 \uD83D\uDC4D" in social.calls)
            assertTrue("react p3 \uD83D\uDC4D" in social.calls)
            assertTrue("votePoll p3 o0" in social.calls)
        }

    @Test
    fun theAuthorAndTheModeratorsOfItsCommunityCloseAnOpenPollAndNobodyElse() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1", role = CommunityRole.MODERATOR)
            social.communities["k2"] = community("k2", role = CommunityRole.MEMBER)
            val open = poll()
            social.homePages +=
                HomePage.End(
                    listOf(
                        post("p1", poll = open),
                        post("p2", communityId = "k2", poll = open),
                        post("p3", communityId = "k2", poll = open, author = self),
                        post("p4", poll = poll(closed = true), author = self),
                    ),
                )
            val state = model().state.value
            val closable = state.posts.map { state.canClose(it) }
            assertEquals(listOf(true, false, true, false), closable)
        }

    @Test
    fun aRetryClearsAProblemThatNoRepeatableCallLeftBehind() =
        runTest(dispatcher) {
            social.homePages += HomePage.More(listOf(post("p1")), "c1")
            social.communities["k1"] = community("k1", role = CommunityRole.MEMBER)
            val model = model()
            social.failOn = "deletePost p1"
            model.deletePost("p1")
            advanceUntilIdle()
            assertNotNull(model.state.value.problem)
            model.retry()
            assertNull(model.state.value.problem)
        }

    @Test
    fun aCommunityTheComposerDoesNotOfferCannotBePostedTo() =
        runTest(dispatcher) {
            val model = model()
            model.onTarget(PostTarget.Community("k9", anonymous = false))
            model.onDraft("Halló")
            model.publish()
            advanceUntilIdle()
            assertTrue(social.written.isEmpty())
            assertEquals("Halló", model.state.value.draft)
        }

    private fun wallPost(id: String) = post(id, poll = poll()).copy(wallOwner = "a2")

    private fun poll(closed: Boolean = false) =
        Poll(listOf(PollOption("o0", "Já", 0uL), PollOption("o1", "Nei", 0uL)), 0uL, null, closed)

    private companion object {
        /** A mute that has not ended. */
        val FAR = ULong.MAX_VALUE / 2uL
    }
}
