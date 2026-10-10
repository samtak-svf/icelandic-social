package samtak.spjall.people

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
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import samtak.spjall.account.FakeAccount
import samtak.spjall.account.Problem
import samtak.spjall.account.unreachable
import samtak.spjall.core.ConversationState
import samtak.spjall.socket.FakeLive
import samtak.spjall.socket.conversation
import samtak.spjall.socket.person

@OptIn(ExperimentalCoroutinesApi::class)
class PeopleViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val account = FakeAccount(signedIn = true)
    private val live = FakeLive()
    private val anna = person("a2", "Anna")
    private val bjorn = person("a3", "Björn")

    @Before fun main() = Dispatchers.setMain(dispatcher)

    @After fun reset() = Dispatchers.resetMain()

    private fun TestScope.model() = PeopleViewModel(account, live, dispatcher).also { advanceUntilIdle() }

    private fun TestScope.opened(model: PeopleViewModel) =
        mutableListOf<String>().also { list -> backgroundScope.launch { model.opened.collect(list::add) } }

    @Test
    fun showsThePeopleMet() =
        runTest(dispatcher) {
            account.people = listOf(anna, bjorn)
            val state = model().state.value
            assertEquals(listOf("a2", "a3"), state.people.map { it.account })
            assertTrue(state.loaded)
        }

    @Test
    fun onePersonOpensTheOneToOneThereIs() =
        runTest(dispatcher) {
            account.conversations =
                listOf(
                    conversation("c-old", anna, state = ConversationState.REMOVED),
                    conversation("c-group", anna, bjorn),
                    conversation("c1", anna),
                )
            val model = model()
            val opened = opened(model)
            model.toggle("a2")
            model.start()
            advanceUntilIdle()
            assertEquals(listOf("c1"), opened)
            assertFalse(account.calls.any { it.startsWith("createConversation") })
            assertEquals(0, live.syncs)
        }

    @Test
    fun morePeopleStartAGroupThatReachesTheServer() =
        runTest(dispatcher) {
            val model = model()
            val opened = opened(model)
            model.toggle("a2")
            model.toggle("a3")
            model.toggle("a2")
            model.toggle("a2")
            model.start()
            advanceUntilIdle()
            assertTrue("createConversation a3,a2" in account.calls)
            assertEquals(listOf("c-new1"), opened)
            assertEquals(1, live.syncs)
        }

    @Test
    fun aFailedStartCanBeTriedAgain() =
        runTest(dispatcher) {
            val model = model()
            val opened = opened(model)
            model.toggle("a2")
            account.failNext = unreachable()
            model.start()
            advanceUntilIdle()
            assertEquals(Problem.Unreachable, model.state.value.problem)
            model.retry()
            advanceUntilIdle()
            assertEquals(listOf("c-new1"), opened)
        }

    @Test
    fun listsEveryoneElseSignedInAfterThePeopleMet() =
        runTest(dispatcher) {
            account.people = listOf(anna)
            account.everyone = listOf(bjorn, anna)
            val state = model().state.value
            assertEquals(listOf("a2"), state.people.map { it.account })
            assertEquals(listOf("a3"), state.everyone.map { it.account })
        }

    @Test
    fun aSearchWaitsForTheTypingToPauseAndAsksTheDirectory() =
        runTest(dispatcher) {
            account.people = listOf(anna)
            account.everyone = listOf(anna, bjorn)
            val model = model()
            model.search("B")
            model.search("Bj")
            advanceUntilIdle()
            assertEquals(listOf("directory - -", "directory Bj -"), account.calls.filter { it.startsWith("directory") })
            assertEquals(
                listOf("a3"),
                model.state.value.everyone
                    .map { it.account },
            )
            // A search over the whole directory finds the people met too.
            model.search("Anna")
            advanceUntilIdle()
            assertEquals(
                listOf("a2"),
                model.state.value.everyone
                    .map { it.account },
            )
        }

    @Test
    fun theNextPageIsAddedOnce() =
        runTest(dispatcher) {
            account.everyone = (1..45).map { person("p$it", "Manneskja $it") }
            val model = model()
            assertEquals(30, model.state.value.directory.size)
            model.more()
            model.more()
            advanceUntilIdle()
            assertEquals(45, model.state.value.directory.size)
            assertEquals(null, model.state.value.next)
            assertEquals(2, account.calls.count { it.startsWith("directory") })
        }

    @Test
    fun aPickSurvivesANewSearch() =
        runTest(dispatcher) {
            account.everyone = listOf(anna, bjorn)
            val model = model()
            model.toggle("a3")
            model.search("Anna")
            advanceUntilIdle()
            model.toggle("a2")
            assertEquals(listOf("a3", "a2"), model.state.value.picked)
        }
}
