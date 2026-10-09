package samtak.spjall.feed

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.first
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
import samtak.spjall.account.FakeAccount
import samtak.spjall.account.FakeAccount.Companion.ME
import samtak.spjall.account.FakeAccount.Companion.post
import samtak.spjall.account.Problem
import samtak.spjall.account.unreachable
import samtak.spjall.core.Person
import samtak.spjall.core.PostReaction
import samtak.spjall.core.ReactionCounts
import samtak.spjall.feed.PostsViewModel.Source

@OptIn(ExperimentalCoroutinesApi::class)
class PostsViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val account = FakeAccount(signedIn = true)
    private val anna = Person("a2", "Anna Jónsdóttir", false)

    @Before fun main() = Dispatchers.setMain(dispatcher)

    @After fun reset() = Dispatchers.resetMain()

    private fun TestScope.model(source: Source = Source.Feed) =
        PostsViewModel(source, account, dispatcher).also { advanceUntilIdle() }

    private fun ids(model: PostsViewModel) =
        model.state.value.posts
            .map { it.postId }

    @Test
    fun theFeedPagesUntilTheLastPage() =
        runTest(dispatcher) {
            account.posts += (1..45).map { post("p$it", anna) }
            val model = model()
            assertEquals(30, ids(model).size)
            assertEquals("a1", model.state.value.me)
            model.loadMore()
            advanceUntilIdle()
            assertEquals((1..45).map { "p$it" }, ids(model))
            assertNull(model.state.value.next)
            model.loadMore()
            advanceUntilIdle()
            assertEquals(listOf("feed -", "feed 30"), account.calls.filter { it.startsWith("feed") })
        }

    @Test
    fun anEmptyFeedIsLoadedAndEmpty() =
        runTest(dispatcher) {
            val state = model().state.value
            assertTrue(state.loaded)
            assertTrue(state.posts.isEmpty())
        }

    @Test
    fun aRefreshKeepsTheOlderPagesAlreadyRead() =
        runTest(dispatcher) {
            account.posts += (1..45).map { post("p$it", anna).copy(createdAt = (1000 - it).toULong()) }
            val model = model()
            model.loadMore()
            advanceUntilIdle()
            account.posts.add(0, post("p0", anna).copy(createdAt = 2000u))
            model.refresh()
            advanceUntilIdle()
            assertEquals(listOf("p0") + (1..45).map { "p$it" }, ids(model))
        }

    @Test
    fun aPostGoesOnTopTrimmedAndBlankIsRefused() =
        runTest(dispatcher) {
            account.posts += post("p1", anna)
            val model = model()
            model.post("   ")
            model.post("x".repeat(POST_LIMIT + 1))
            advanceUntilIdle()
            assertTrue(account.calls.none { it.startsWith("createPost") })
            val posted = backgroundScope.async { model.posted.first() }
            model.post("  Góðan daginn  ")
            advanceUntilIdle()
            assertEquals(Unit, posted.await())
            assertEquals(
                "Góðan daginn",
                model.state.value.posts
                    .first()
                    .body,
            )
            assertEquals(2, ids(model).size)
        }

    @Test
    fun theHeartShowsAtOnceAndIsPutBackWhenRefused() =
        runTest(dispatcher) {
            account.posts += post("p1", anna)
            val model = model()
            model.toggleHeart(
                model.state.value.posts
                    .single(),
            )
            val hearted =
                model.state.value.posts
                    .single()
            assertEquals(PostReaction.HEART, hearted.myReaction)
            assertEquals(1u, hearted.reactions.heart)
            advanceUntilIdle()
            assertEquals("reactToPost p1 HEART", account.calls.last())

            account.failNext = unreachable()
            model.toggleHeart(hearted)
            assertNull(
                model.state.value.posts
                    .single()
                    .myReaction,
            )
            advanceUntilIdle()
            assertEquals(
                hearted,
                model.state.value.posts
                    .single(),
            )
            assertEquals(Problem.Unreachable, model.state.value.problem)
        }

    @Test
    fun theHeartTakesBackAnyReaction() {
        val laughed = post("p1", anna, reactions = ReactionCounts(2u, 0u, 1u, 0u, 0u), mine = PostReaction.LAUGH)
        val back = laughed.toggledHeart()
        assertNull(back.myReaction)
        assertEquals(ReactionCounts(2u, 0u, 0u, 0u, 0u), back.reactions)
        assertEquals(2u, back.reactions.total())
    }

    @Test
    fun deletingRemovesThePost() =
        runTest(dispatcher) {
            account.posts += listOf(post("p1", ME), post("p2", anna))
            val model = model()
            model.delete("p1")
            advanceUntilIdle()
            assertEquals(listOf("p2"), ids(model))
            assertEquals("deletePost p1", account.calls.last())
        }

    @Test
    fun myWallIsMyPostsOnly() =
        runTest(dispatcher) {
            account.posts += listOf(post("p1", ME), post("p2", anna), post("p3", ME))
            val model = model(Source.Mine)
            assertEquals(listOf("p1", "p3"), ids(model))
        }

    @Test
    fun anotherWallSaysWhoAndOpensTheOneToOne() =
        runTest(dispatcher) {
            account.people = listOf(anna)
            account.posts += listOf(post("p1", ME), post("p2", anna))
            val model = model(Source.Wall("a2"))
            assertEquals(anna, model.state.value.person)
            assertFalse(model.state.value.blocked)
            assertEquals(listOf("p2"), ids(model))
            val opened = backgroundScope.async { model.opened.first() }
            model.contact()
            advanceUntilIdle()
            assertEquals("c-a2", opened.await())
        }

    @Test
    fun aBlockedAccountsWallSaysSo() =
        runTest(dispatcher) {
            account.people = listOf(anna)
            account.blockedPeople += anna
            assertTrue(model(Source.Wall("a2")).state.value.blocked)
        }

    @Test
    fun aFailedFirstPageIsAProblemThatRefreshClears() =
        runTest(dispatcher) {
            account.failNext = unreachable()
            val model = model()
            assertEquals(Problem.Unreachable, model.state.value.problem)
            assertTrue(model.state.value.loaded)
            model.refresh()
            advanceUntilIdle()
            assertNull(model.state.value.problem)
        }
}
