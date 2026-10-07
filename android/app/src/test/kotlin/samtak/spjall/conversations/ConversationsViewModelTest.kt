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
}
