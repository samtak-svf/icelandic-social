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
}
