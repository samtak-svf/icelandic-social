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
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import samtak.spjall.account.Problem
import samtak.spjall.account.unreachable
import samtak.spjall.core.CommunityAudience

@OptIn(ExperimentalCoroutinesApi::class)
class CreateCommunityViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val social = FakeSocial()

    @Before fun main() = Dispatchers.setMain(dispatcher)

    @After fun reset() = Dispatchers.resetMain()

    @Test
    fun aNameIsNeededAndTheNewCommunityIsOpened() =
        runTest(dispatcher) {
            val model = CreateCommunityViewModel(social, dispatcher)
            val created = mutableListOf<String>()
            backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { model.created.collect(created::add) }
            model.create()
            advanceUntilIdle()
            assertTrue(social.calls.isEmpty())
            model.name("  Kórinn ")
            model.description("Við syngjum")
            model.audience(CommunityAudience.PRIVATE)
            model.create()
            advanceUntilIdle()
            assertEquals(listOf("createCommunity Kórinn"), social.calls)
            assertEquals(listOf("k-new0"), created)
            assertEquals(CommunityAudience.PRIVATE, social.communities.getValue("k-new0").audience)
        }

    @Test
    fun theNameStopsAtTheServersLimit() =
        runTest(dispatcher) {
            val model = CreateCommunityViewModel(social, dispatcher)
            model.name("a".repeat(NAME_LIMIT))
            model.name("a".repeat(NAME_LIMIT + 1))
            assertEquals(NAME_LIMIT, model.state.value.name.length)
        }

    @Test
    fun aFailureIsShownAndNothingIsOpened() =
        runTest(dispatcher) {
            val model = CreateCommunityViewModel(social, dispatcher)
            val created = mutableListOf<String>()
            backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { model.created.collect(created::add) }
            model.name("Kórinn")
            social.failNext = unreachable()
            model.create()
            advanceUntilIdle()
            assertEquals(Problem.Unreachable, model.state.value.problem)
            assertTrue(created.isEmpty())
            assertFalse(model.state.value.busy)
        }
}
