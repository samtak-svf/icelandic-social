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
import samtak.spjall.core.HomePage
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
            repeat(12) { social.homePages += HomePage.More(emptyList(), "c$it") }
            social.homePages += HomePage.End(listOf(post("p9")))
            val model = model()
            assertEquals("five empty pages in one go", 5, homeCalls())
            assertEquals(FeedPhase.LOADING, model.state.value.phase)
            assertNotNull(model.state.value.next)
            model.more()
            advanceUntilIdle()
            assertEquals("the next go is five more", 10, homeCalls())
            assertEquals(FeedPhase.LOADING, model.state.value.phase)
            model.more()
            advanceUntilIdle()
            assertEquals(FeedPhase.LIST, model.state.value.phase)
            assertNull(model.state.value.next)
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
            val model = model()
            val community = PostTarget.Community("k1", anonymous = true)
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
            social.offered += community("k1")
            val wallPost =
                post("p2")
                    .copy(wallOwner = "a2")
            social.homePages += HomePage.End(listOf(post("p1"), wallPost))
            val model = model()
            val (inCommunity, onWall) = model.state.value.posts
            assertEquals("k1", model.headingOf(inCommunity))
            assertNull(model.headingOf(onWall))
        }
}
