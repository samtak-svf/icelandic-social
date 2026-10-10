package samtak.spjall.conversations

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
import samtak.spjall.account.FakeAccount
import samtak.spjall.account.Problem
import samtak.spjall.account.unreachable
import samtak.spjall.core.Event
import samtak.spjall.core.Inviter
import samtak.spjall.socket.Connection
import samtak.spjall.socket.FakeLive
import samtak.spjall.socket.conversation
import samtak.spjall.socket.person

@OptIn(ExperimentalCoroutinesApi::class)
class ConversationsViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val account = FakeAccount(signedIn = true)
    private val live = FakeLive()

    @Before fun main() = Dispatchers.setMain(dispatcher)

    @After fun reset() = Dispatchers.resetMain()

    private fun TestScope.model() = ConversationsViewModel(account, live, dispatcher).also { advanceUntilIdle() }

    private fun reads() = account.calls.count { it == "conversations" }

    @Test
    fun showsTheListAndTheConnection() =
        runTest(dispatcher) {
            account.conversations = listOf(conversation("c1", person("a2", "Anna")))
            val model = model()
            val state = model.state.value
            assertEquals(listOf("c1"), state.conversations.map { it.id })
            assertTrue(state.loaded)
            assertEquals(Connection.Connecting, state.connection)

            live.connection.value = Connection.Offline
            advanceUntilIdle()
            assertEquals(Connection.Offline, model.state.value.connection)
        }

    @Test
    fun readsTheListAgainAfterAnEventButNotForTyping() =
        runTest(dispatcher) {
            model()
            assertEquals(1, reads())
            account.conversations = listOf(conversation("c1"))
            live.events.emit(Event.Typing("c1", true))
            advanceUntilIdle()
            assertEquals(1, reads())
            live.events.emit(Event.Timeline("c1", listOf(4uL)))
            advanceUntilIdle()
            assertEquals(2, reads())
        }

    @Test
    fun aFailedReadIsAProblemThatRetryClears() =
        runTest(dispatcher) {
            account.failNext = unreachable()
            val model = model()
            assertEquals(Problem.Unreachable, model.state.value.problem)
            model.load()
            advanceUntilIdle()
            assertNull(model.state.value.problem)
        }

    @Test
    fun anInviteOpensItsOneToOneAndSyncsIt() =
        runTest(dispatcher) {
            account.inviters = mapOf("tok" to Inviter("a2", "Anna", true))
            val model = model()
            val opened = mutableListOf<String>()
            backgroundScope.launch { model.opened.collect(opened::add) }
            model.openInvite("tok")
            advanceUntilIdle()
            assertEquals(listOf("c-a2"), opened)
            assertEquals(1, live.syncs)
        }

    @Test
    fun aDeadInviteSaysSoAndTheOperatorsOpensNothing() =
        runTest(dispatcher) {
            account.inviters = mapOf("operator" to null)
            val model = model()
            model.openInvite("dead")
            advanceUntilIdle()
            assertTrue(model.state.value.inviteExpired)

            model.openInvite("operator")
            advanceUntilIdle()
            assertFalse(model.state.value.inviteExpired)
            assertNull(model.state.value.problem)
            assertEquals(0, live.syncs)
        }

    @Test
    fun theLinkThatLetThePersonInIsNoDeadLinkWhenUsedUp() =
        runTest(dispatcher) {
            val model = model()
            model.openInvite("operator", signedUp = true)
            advanceUntilIdle()
            assertFalse(model.state.value.inviteExpired)
            assertNull(model.state.value.problem)
        }

    @Test
    fun aSearchWaitsForTheTypingToPauseThenFindsConversationsAndPeopleNoneTwice() =
        runTest(dispatcher) {
            val thordis = person("a2", "Þórdís Ýr")
            val soley = person("a3", "Sóley Bergs-Þórsdóttir")
            account.conversations = listOf(conversation("c1", thordis), conversation("c2", soley))
            account.everyone = listOf(thordis, person("a4", "Þórunn Halla"))
            val model = model()
            model.search("Þ")
            model.search("Þór")
            assertTrue(model.state.value.searching)
            advanceUntilIdle()
            // One search, for what was typed last, in one call; the hyphenated surname counts as a word.
            val asked = account.calls.filter { it.startsWith("search") || it.startsWith("directory") }
            assertEquals(listOf("searchList Þór"), asked)
            val found = model.state.value.found!!
            assertEquals(listOf("c1", "c2"), found.conversations.map { it.id })
            // Þórdís's 1:1 is among the conversations, so she is not among the people too (0038).
            assertEquals(listOf("a4"), found.people.map { it.account })
            assertFalse(model.state.value.searching)

            // Cleared, the list is back and nothing more is asked.
            model.search(" ")
            advanceUntilIdle()
            assertNull(model.state.value.found)
            assertEquals(1, account.calls.count { it.startsWith("searchList") })
        }

    @Test
    fun aPersonFoundOpensTheirOneToOne() =
        runTest(dispatcher) {
            val model = model()
            val opened = mutableListOf<String>()
            backgroundScope.launch { model.opened.collect(opened::add) }
            model.openPerson("a4")
            advanceUntilIdle()
            assertEquals(listOf("c-a4"), opened)
            assertEquals(1, live.syncs)
        }

    @Test
    fun aFailedSearchIsAProblemThatRetrySearchesAgain() =
        runTest(dispatcher) {
            val model = model()
            account.failNext = unreachable()
            model.search("Anna")
            advanceUntilIdle()
            assertEquals(Problem.Unreachable, model.state.value.problem)
            model.retry()
            advanceUntilIdle()
            assertNull(model.state.value.problem)
            assertEquals(2, account.calls.count { it.startsWith("searchList") })
        }
}
