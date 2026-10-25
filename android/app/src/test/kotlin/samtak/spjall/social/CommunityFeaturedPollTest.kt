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
import samtak.spjall.conversation.Picked
import samtak.spjall.core.CommunityImage
import samtak.spjall.core.CommunityRole
import samtak.spjall.core.Poll
import samtak.spjall.core.PollOption
import samtak.spjall.core.Post

@OptIn(ExperimentalCoroutinesApi::class)
class CommunityFeaturedPollTest {
    private val dispatcher = StandardTestDispatcher()
    private val social = FakeSocial()
    private val now = 1_800_000_000_000L

    @Before fun main() = Dispatchers.setMain(dispatcher)

    @After fun reset() = Dispatchers.resetMain()

    /** The community screen's state as it stands. */
    private val CommunityViewModel.snap get() = state.value

    /** The poll on the one post the feed holds. */
    private val CommunityViewModel.poll get() = snap.posts.first().poll

    private fun TestScope.model(id: String = "k1") =
        CommunityViewModel(id, social, { now }, dispatcher).also { advanceUntilIdle() }

    @Test
    fun pinningFeaturesThePostAndTheFeedStaysChronological() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1", role = CommunityRole.OWNER)
            social.posts["k1"] = mutableListOf(post("p1"), post("p2"))
            val model = model()
            model.pin("p2", true)
            advanceUntilIdle()
            assertTrue("pinPost k1 p2" in social.calls)
            val state = model.state.value
            assertEquals(listOf("p1", "p2"), state.posts.map { it.postId })
            assertEquals(listOf("p2"), state.featured.map { it.postId })
            assertTrue(state.posts.single { it.postId == "p2" }.pinned)
            model.pin("p2", false)
            advanceUntilIdle()
            assertTrue("unpinPost k1 p2" in social.calls)
            assertTrue(model.snap.featured.isEmpty())
        }

    @Test
    fun theNewestPinComesFirstAndAFourthPinIsRefusedWithAMessage() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1", role = CommunityRole.OWNER)
            social.posts["k1"] = mutableListOf(post("p4"), post("p3"), post("p2"), post("p1"))
            val model = model()
            listOf("p1", "p2", "p3").forEach {
                model.pin(it, true)
                advanceUntilIdle()
            }
            assertEquals(listOf("p3", "p2", "p1"), model.snap.featured.map { it.postId })
            model.pin("p4", true)
            advanceUntilIdle()
            assertEquals(Problem.PinFull, model.snap.problem)
            assertEquals(3, model.snap.featured.size)
            model.pin("p1", false)
            advanceUntilIdle()
            assertNull(model.snap.problem)
        }

    @Test
    fun theFeaturedTabIsGoneWhenNothingIsFeatured() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1", role = CommunityRole.OWNER)
            social.posts["k1"] = mutableListOf(post("p1"))
            val model = model()
            assertFalse(CommunityTab.FEATURED in model.snap.visibleTabs())
            model.pin("p1", true)
            advanceUntilIdle()
            assertTrue(CommunityTab.FEATURED in model.snap.visibleTabs())
            model.selectTab(CommunityTab.FEATURED)
            model.pin("p1", false)
            advanceUntilIdle()
            assertEquals(CommunityTab.DISCUSSION, model.snap.shownTab())
        }

    @Test
    fun myndirReadsItsFirstPageWhenOpenedAndTheNextOnDemand() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1", role = CommunityRole.MEMBER)
            social.images["k1"] = (1..5).map { CommunityImage("m$it", "p$it", null, 640u, 480u, 1_700_000_000_000uL) }
            social.pageSize = 3
            val model = model()
            assertTrue("communityImages k1" !in social.calls)
            model.selectTab(CommunityTab.IMAGES)
            advanceUntilIdle()
            assertEquals(3, model.snap.gallery.size)
            assertTrue(model.snap.galleryLoaded)
            model.moreGallery()
            advanceUntilIdle()
            assertEquals(5, model.snap.gallery.size)
            assertNull(model.snap.galleryNext)
        }

    @Test
    fun medlimirReadsTheMembersWhenOpened() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1", role = CommunityRole.MEMBER)
            val model = model()
            model.selectTab(CommunityTab.MEMBERS)
            advanceUntilIdle()
            assertTrue(social.calls.any { it.startsWith("communityMembers") })
        }

    @Test
    fun aPollNeedsTwoOptionsAndTextAndHoldsAtMostSix() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1", role = CommunityRole.MEMBER)
            val model = model()
            model.togglePoll()
            model.draft("Hvar?")
            assertEquals(2, model.snap.poll?.size)
            assertFalse(model.snap.postable)
            model.pollOption(0, "Hér")
            model.pollOption(1, "Þar")
            assertTrue(model.snap.postable)
            model.pollOption(1, "Hér")
            assertFalse(model.snap.postable)
            model.pollOption(1, "x".repeat(81))
            assertEquals("Hér", model.snap.poll?.get(1))
            repeat(8) { model.addPollOption() }
            assertEquals(6, model.snap.poll?.size)
            repeat(8) { model.removePollOption(0) }
            assertEquals(2, model.snap.poll?.size)
        }

    @Test
    fun aPollPostGoesThroughCreatePostWithAndTheDraftIsCleared() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1", role = CommunityRole.MEMBER)
            val model = model()
            model.togglePoll()
            model.draft("Hvar?")
            model.pollOption(0, "Hér")
            model.pollOption(1, "Þar")
            model.publish()
            advanceUntilIdle()
            assertTrue(social.calls.any { it.startsWith("createPostWith k1 Hvar? anonymous=false poll=Hér|Þar") })
            assertNull(model.snap.poll)
            assertEquals("", model.snap.draft)
            assertEquals(2, model.poll?.options?.size)
        }

    @Test
    fun aPlainPostStillUsesCreatePost() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1", role = CommunityRole.MEMBER)
            val model = model()
            model.draft("Halló")
            model.publish()
            advanceUntilIdle()
            assertTrue(social.calls.any { it.startsWith("createPost k1") })
            assertTrue(social.calls.none { it.startsWith("createPostWith") })
        }

    @Test
    fun aPollCannotBeStartedAfterImagesAreChosenAndImagesAreIgnoredDuringAPoll() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1", role = CommunityRole.MEMBER)
            val model = model()
            model.togglePoll()
            model.pick(Picked("image/jpeg", 10) { error("not read") })
            advanceUntilIdle()
            assertTrue(model.snap.images.isEmpty())
        }

    @Test
    fun votingWithdrawingAndClosingReplaceThePostInTheFeed() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1", role = CommunityRole.OWNER)
            val poll = Poll(listOf(PollOption("o1", "Já", null), PollOption("o2", "Nei", null)), 0uL, null, false)
            social.posts["k1"] = mutableListOf(post("p1", poll = poll))
            val model = model()
            model.vote("p1", "o1")
            advanceUntilIdle()
            assertEquals("o1", model.poll?.mine)
            assertEquals(1uL, model.poll?.total)
            model.withdrawVote("p1")
            advanceUntilIdle()
            assertNull(model.poll?.mine)
            model.closePoll("p1")
            advanceUntilIdle()
            assertTrue(model.poll?.closed == true)
            model.vote("p1", "o2")
            advanceUntilIdle()
            assertEquals(Problem.PollClosed, model.snap.problem)
            assertTrue(model.snap.answering.isEmpty())
        }

    @Test
    fun anAnonymousPostIsSentAnonymousOnlyWhereTheCommunityAllowsIt() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1", role = CommunityRole.MEMBER, anonymousPosts = true)
            val model = model()
            model.setAnonymous(true)
            model.draft("Leyndó")
            model.publish()
            advanceUntilIdle()
            assertTrue(social.calls.any { it.startsWith("createPostWith k1 Leyndó anonymous=true") })
            assertFalse(model.snap.anonymous)
            social.communities["k1"] = community("k1", role = CommunityRole.MEMBER)
            val other = model()
            other.setAnonymous(true)
            other.draft("Opið")
            other.publish()
            advanceUntilIdle()
            assertTrue(social.calls.any { it.startsWith("createPost k1 Opið") })
        }

    @Test
    fun theOwnerSwitchesAnonymousPostsAndKeepsTheFeaturedPosts() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1", role = CommunityRole.OWNER)
            social.posts["k1"] = mutableListOf(post("p1"))
            val model = model()
            model.pin("p1", true)
            advanceUntilIdle()
            model.setAnonymousPosts(true)
            advanceUntilIdle()
            assertTrue("setAnonymousPosts k1 true" in social.calls)
            assertTrue(model.snap.community?.anonymousPosts == true)
            assertEquals(listOf("p1"), model.snap.featured.map { it.postId })
        }

    @Test
    fun aModeratorRevealsTheAuthorOfAnAnonymousPost() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1", role = CommunityRole.OWNER, anonymousPosts = true)
            social.posts["k1"] = mutableListOf(post("p1", author = null, anonymous = true))
            val model = model()
            model.revealAuthor("p1")
            advanceUntilIdle()
            assertEquals("Anna", model.snap.revealed["p1"])
        }

    private val feed = listOf(post("p3"), post("p2"), post("p1"))
    private val featured = listOf(post("p2", pinned = true))

    /** The ids the Umræða feed draws for [held] in the aside layout. */
    private fun asideFeed(held: List<Post>) = feedPosts(feed, held, strip = false, searching = false).map { it.postId }

    @Test
    fun theAsideTakesTheFeaturedPostsOutOfTheFeedAndKeepsTheOrder() {
        assertEquals(listOf("p3", "p1"), asideFeed(featured))
    }

    @Test
    fun theStripLayoutsKeepTheFeedComplete() {
        assertEquals(feed, feedPosts(feed, featured, strip = true, searching = false))
    }

    @Test
    fun aSearchKeepsEveryPostEvenInTheAsideLayout() {
        assertEquals(feed, feedPosts(feed, featured, strip = false, searching = true))
    }

    @Test
    fun aReleasedPostIsBackInTheFeedWhenTheFeaturedListChanges() {
        assertEquals(listOf("p3", "p1"), asideFeed(featured))
        assertEquals(listOf("p3", "p2", "p1"), asideFeed(emptyList()))
    }
}
