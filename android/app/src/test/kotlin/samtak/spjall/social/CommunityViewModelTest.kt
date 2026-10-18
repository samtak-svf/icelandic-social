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
import samtak.spjall.core.CommunityAudience
import samtak.spjall.core.CommunityRole
import samtak.spjall.core.ReactionCount
import samtak.spjall.core.ReactionKind
import samtak.spjall.core.ReportReason
import samtak.spjall.core.ReportTarget
import samtak.spjall.core.ReportTargetKind

@OptIn(ExperimentalCoroutinesApi::class)
class CommunityViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val social = FakeSocial()
    private val now = 1_800_000_000_000L

    @Before fun main() = Dispatchers.setMain(dispatcher)

    @After fun reset() = Dispatchers.resetMain()

    private fun TestScope.model(id: String = "k1") =
        CommunityViewModel(id, social, { now }, dispatcher).also { advanceUntilIdle() }

    @Test
    fun aMemberSeesThePostsNewestFirstAndMayWrite() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1", role = CommunityRole.MEMBER)
            social.posts["k1"] = mutableListOf(post("p2"), post("p1"))
            val state = model().state.value
            assertEquals(listOf("p2", "p1"), state.posts.map { it.postId })
            assertTrue(state.writes)
            assertFalse(state.muted)
        }

    @Test
    fun aPrivateCommunityIsNotReadUntilJoined() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1", audience = CommunityAudience.PRIVATE)
            social.posts["k1"] = mutableListOf(post("p1"))
            val model = model()
            assertTrue(
                model.state.value.posts
                    .isEmpty(),
            )
            assertFalse(social.calls.any { it.startsWith("communityPosts") })
            assertFalse(model.state.value.writes)
            model.join()
            advanceUntilIdle()
            assertTrue("joinCommunity k1" in social.calls)
            assertTrue(
                model.state.value.community!!
                    .joinRequested,
            )
        }

    @Test
    fun joiningAnOpenCommunityLetsItWrite() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1")
            val model = model()
            assertFalse(model.state.value.writes)
            model.join()
            advanceUntilIdle()
            assertTrue(model.state.value.writes)
            model.leave()
            advanceUntilIdle()
            assertFalse(model.state.value.writes)
        }

    @Test
    fun aMutedMemberReadsButDoesNotWrite() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1", role = CommunityRole.MEMBER, mutedUntil = (now + 1).toULong())
            val model = model()
            assertTrue(model.state.value.muted)
            assertFalse(model.state.value.writes)
            model.draft("Halló")
            model.publish()
            advanceUntilIdle()
            assertFalse(social.calls.any { it.startsWith("createPost") })
        }

    @Test
    fun aPublishedPostGoesToTheTopAndTheBoxEmpties() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1", role = CommunityRole.MEMBER)
            social.posts["k1"] = mutableListOf(post("p1"))
            val model = model()
            model.draft("  Nýr póstur ")
            model.publish()
            advanceUntilIdle()
            assertTrue("createPost k1 Nýr póstur" in social.calls)
            assertEquals(
                listOf("p-new0", "p1"),
                model.state.value.posts
                    .map { it.postId },
            )
            assertEquals("", model.state.value.draft)
        }

    @Test
    fun aReactionIsSetThenTakenBack() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1", role = CommunityRole.MEMBER)
            social.posts["k1"] = mutableListOf(post("p1", reactions = listOf(ReactionCount(ReactionKind.LIKE, 2uL))))
            val model = model()
            model.react("p1", ReactionKind.LIKE)
            advanceUntilIdle()
            val liked =
                model.state.value.posts
                    .single()
            assertEquals(ReactionKind.LIKE, liked.myReaction)
            assertEquals(3uL, liked.reactions.single().count)
            model.react("p1", ReactionKind.LIKE)
            advanceUntilIdle()
            assertNull(
                model.state.value.posts
                    .single()
                    .myReaction,
            )
            assertEquals(listOf("react p1 LIKE", "unreact p1"), social.calls.filter { it.contains("react") })
        }

    @Test
    fun aReportMarksThePost() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1", role = CommunityRole.MEMBER)
            social.posts["k1"] = mutableListOf(post("p1"))
            val model = model()
            model.report(ReportTarget(ReportTargetKind.POST, "p1"), ReportReason.SPAM, " rusl ")
            advanceUntilIdle()
            assertTrue("report POST p1 SPAM rusl" in social.calls)
            assertEquals(setOf("p1"), model.state.value.reported)
        }

    @Test
    fun olderPostsComeAfter() =
        runTest(dispatcher) {
            social.pageSize = 1
            social.communities["k1"] = community("k1", role = CommunityRole.MEMBER)
            social.posts["k1"] = mutableListOf(post("p2"), post("p1"))
            val model = model()
            model.more()
            advanceUntilIdle()
            assertEquals(
                listOf("p2", "p1"),
                model.state.value.posts
                    .map { it.postId },
            )
        }

    @Test
    fun aFailedLoadCanBeTriedAgain() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1")
            social.failNext = unreachable()
            val model = model()
            assertEquals(Problem.Unreachable, model.state.value.problem)
            model.retry()
            advanceUntilIdle()
            assertNull(model.state.value.problem)
            assertEquals(
                "k1",
                model.state.value.community
                    ?.communityId,
            )
        }
}
