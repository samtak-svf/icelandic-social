package samtak.spjall.social

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
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
import samtak.spjall.conversation.Picked
import samtak.spjall.core.CommunityAudience
import samtak.spjall.core.CommunityMember
import samtak.spjall.core.CommunityRole
import samtak.spjall.core.CoreException
import samtak.spjall.core.LogTarget
import samtak.spjall.core.LogTargetKind
import samtak.spjall.core.ModerationLogAction
import samtak.spjall.core.ModerationLogEntry
import samtak.spjall.core.ReactionCount
import samtak.spjall.core.ReactionKind
import samtak.spjall.core.ReportReason
import samtak.spjall.core.ReportTarget
import samtak.spjall.core.ReportTargetKind
import java.io.File

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
    fun searchesPostsInsideTheCommunity() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1", role = CommunityRole.MEMBER)
            social.posts["k1"] = mutableListOf(post("p1", body = "Æfing á þriðjudegi"), post("p2", body = "Tónleikar"))
            val model = model()
            model.onSearchQuery("  æfing  ")
            model.searchPosts()
            advanceUntilIdle()
            assertEquals(
                listOf("p1"),
                model.state.value.posts
                    .map { it.postId },
            )
            assertTrue("communityPosts k1 æfing" in social.calls)
        }

    @Test
    fun anOwnerCanEditTheCommunityAndSetAOneWayAudienceChange() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1", role = CommunityRole.OWNER)
            val model = model()
            model.updateCommunity("Nýtt heiti", "Ný lýsing", CommunityAudience.PRIVATE)
            advanceUntilIdle()
            assertEquals(
                "Nýtt heiti",
                model.state.value.community
                    ?.name,
            )
            assertEquals(
                "Ný lýsing",
                model.state.value.community
                    ?.description,
            )
            assertEquals(
                CommunityAudience.PRIVATE,
                model.state.value.community
                    ?.audience,
            )
            assertTrue(social.calls.any { it.startsWith("updateCommunity k1 Nýtt heiti Ný lýsing") })
        }

    @Test
    fun anOwnerCanChangeMemberRoles() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1", role = CommunityRole.OWNER)
            social.members["k1"] = mutableListOf(CommunityMember("a2", "Anna", true, CommunityRole.MEMBER, 1uL))
            val model = model()
            model.loadMembers()
            advanceUntilIdle()
            model.setCommunityRole("a2", CommunityRole.MODERATOR)
            advanceUntilIdle()
            assertEquals(
                CommunityRole.MODERATOR,
                model.state.value.members
                    .single()
                    .role,
            )
            assertTrue("setCommunityRole k1 a2 MODERATOR" in social.calls)
        }

    @Test
    fun moderatorsCanLoadTheCommunityActionLog() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1", role = CommunityRole.MODERATOR)
            social.moderationLogs["k1"] =
                mutableListOf(
                    ModerationLogEntry(
                        entryId = 1uL,
                        communityId = "k1",
                        actor = self,
                        asPlatform = false,
                        action = ModerationLogAction.HIDE_POST,
                        target = LogTarget(LogTargetKind.POST, "p1"),
                        targetAccount = anna,
                        reason = "Ruslefni",
                        createdAt = 1uL,
                    ),
                )
            val model = model()
            model.loadModerationLog()
            advanceUntilIdle()
            assertEquals(
                ModerationLogAction.HIDE_POST,
                model.state.value.moderationLog
                    .single()
                    .action,
            )
            assertTrue("communityModerationLog k1" in social.calls)
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

    @Test
    fun aRequestToJoinCanBeWithdrawn() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1", audience = CommunityAudience.PRIVATE)
            val model = model()
            model.join()
            advanceUntilIdle()
            assertTrue(
                model.state.value.community!!
                    .joinRequested,
            )
            model.withdraw()
            advanceUntilIdle()
            assertTrue("withdrawJoinRequest k1" in social.calls)
            assertFalse(
                model.state.value.community!!
                    .joinRequested,
            )
        }

    @Test
    fun onlyThisAccountsOwnPostIsDeleted() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1", role = CommunityRole.MEMBER)
            social.posts["k1"] = mutableListOf(post("p2", author = self), post("p1"))
            val model = model()
            assertEquals("a1", model.state.value.me)
            model.delete("p2")
            advanceUntilIdle()
            assertTrue("deletePost p2" in social.calls)
            assertEquals(
                listOf("p1"),
                model.state.value.posts
                    .map { it.postId },
            )
        }

    @Test
    fun pickedImagesAreUploadedAndPostedWithTheText() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1", role = CommunityRole.MEMBER)
            val model = model()
            val first = picked()
            val second = picked()
            model.pick(first.second)
            model.pick(second.second)
            advanceUntilIdle()
            assertEquals(listOf(first.first.path, second.first.path), model.state.value.images)
            model.draft("Myndir")
            model.publish()
            advanceUntilIdle()
            assertTrue("createPost k1 Myndir m-${first.first.name},m-${second.first.name}" in social.calls)
            val state = model.state.value
            assertEquals(
                2,
                state.posts
                    .first()
                    .images.size,
            )
            assertTrue(state.images.isEmpty())
            assertFalse(first.first.exists())
        }

    @Test
    fun anImageAlonePostsWithoutText() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1", role = CommunityRole.MEMBER)
            val model = model()
            assertFalse(model.state.value.postable)
            val image = picked()
            model.pick(image.second)
            advanceUntilIdle()
            assertTrue(model.state.value.postable)
            model.publish()
            advanceUntilIdle()
            assertTrue("createPost k1  m-${image.first.name}" in social.calls)
        }

    @Test
    fun aFifthImageIsRefusedWithASentence() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1", role = CommunityRole.MEMBER)
            val model = model()
            repeat(IMAGES) { model.pick(picked().second) }
            advanceUntilIdle()
            assertNull(model.state.value.imageNotice)
            assertFalse(model.roomForImage())
            model.pick(picked().second)
            advanceUntilIdle()
            assertEquals(IMAGES, model.state.value.images.size)
            assertEquals(CommunityViewModel.ImageNotice.TooMany, model.state.value.imageNotice)
            removeOneFrom(model)
            assertTrue(model.roomForImage())
            assertNull(model.state.value.imageNotice)
        }

    @Test
    fun severalPickedAtOnceKeepTheirOrderAndStopAtFour() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1", role = CommunityRole.MEMBER)
            val model = model()
            model.pick(picked().second)
            advanceUntilIdle()
            assertEquals(IMAGES - 1, model.room())
            val four = List(4) { picked() }
            model.pick(four.map { it.second })
            advanceUntilIdle()
            assertEquals(IMAGES, model.state.value.images.size)
            assertEquals(
                four.take(3).map { it.first.path },
                model.state.value.images
                    .drop(1),
            )
            assertEquals(CommunityViewModel.ImageNotice.TooMany, model.state.value.imageNotice)
            assertEquals(0, model.room())
        }

    @Test
    fun aLargeOneAmongSeveralIsLeftOutAndNamed() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1", role = CommunityRole.MEMBER)
            val model = model()
            val small = picked()
            model.pick(listOf(Picked("image/jpeg", IMAGE_LIMIT + 1) { error("not read") }, small.second))
            advanceUntilIdle()
            assertEquals(listOf(small.first.path), model.state.value.images)
            assertEquals(CommunityViewModel.ImageNotice.TooLarge, model.state.value.imageNotice)
        }

    @Test
    fun anImageTooLargeIsNotTaken() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1", role = CommunityRole.MEMBER)
            val model = model()
            model.pick(Picked("image/jpeg", IMAGE_LIMIT + 1) { error("not read") })
            advanceUntilIdle()
            assertTrue(
                model.state.value.images
                    .isEmpty(),
            )
            assertEquals(CommunityViewModel.ImageNotice.TooLarge, model.state.value.imageNotice)
        }

    @Test
    fun anImageTheServerRefusesIsNamedAndNothingIsPosted() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1", role = CommunityRole.MEMBER)
            val model = model()
            model.pick(picked().second)
            advanceUntilIdle()
            social.refuseImage = CoreException.Refused(422u, "invalid_image", null)
            model.publish()
            advanceUntilIdle()
            assertEquals(CommunityViewModel.ImageNotice.Invalid, model.state.value.imageNotice)
            assertNull(model.state.value.problem)
            assertFalse(social.calls.any { it.startsWith("createPost") })
            assertEquals(1, model.state.value.images.size)
            social.refuseImage = CoreException.Refused(413u, "too_large", null)
            model.publish()
            advanceUntilIdle()
            assertEquals(CommunityViewModel.ImageNotice.TooLarge, model.state.value.imageNotice)
        }

    /** A picked image whose copy is a real file in the temp folder. */
    private fun picked(): Pair<File, Picked> {
        val file = File.createTempFile("picked", ".jpg").apply { deleteOnExit() }
        file.writeBytes(byteArrayOf(1, 2, 3))
        return file to Picked("image/jpeg", file.length()) { file }
    }

    private fun TestScope.removeOneFrom(model: CommunityViewModel) {
        model.unpick(
            model.state.value.images
                .last(),
        )
        advanceUntilIdle()
    }

    @Test
    fun aDeclinedRequestInTheFutureBlocksAskingAgainUntilItsDate() =
        runTest(dispatcher) {
            val until = (now + 86_400_000L).toULong()
            social.communities["k1"] =
                community("k1", audience = CommunityAudience.PRIVATE, joinDeclinedUntil = until)
            assertEquals(until, model().state.value.declinedUntil)
        }

    @Test
    fun aDeclineThatHasPassedLeavesTheJoinButton() =
        runTest(dispatcher) {
            social.communities["k1"] =
                community("k1", audience = CommunityAudience.PRIVATE, joinDeclinedUntil = (now - 1).toULong())
            assertNull(model().state.value.declinedUntil)
        }

    @Test
    fun theOwnerDeletesTheCommunityAndTheScreenIsToldToLeave() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1", role = CommunityRole.OWNER)
            val model = model()
            val told = mutableListOf<Unit>()
            val job = backgroundScope.launch(dispatcher) { model.deleted.collect { told += it } }
            model.deleteCommunity()
            advanceUntilIdle()
            assertTrue("deleteCommunity k1" in social.calls)
            assertEquals(1, told.size)
            job.cancel()
        }

    @Test
    fun aRefusedDeleteShowsTheNamedProblemAndStays() =
        runTest(dispatcher) {
            social.communities["k1"] = community("k1", role = CommunityRole.MODERATOR)
            val model = model()
            social.failNext = CoreException.Refused(403u, "not_permitted", null)
            model.deleteCommunity()
            advanceUntilIdle()
            assertEquals(Problem.NotPermitted, model.state.value.problem)
        }
}
