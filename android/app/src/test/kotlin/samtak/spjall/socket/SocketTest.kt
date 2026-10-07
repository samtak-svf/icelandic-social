package samtak.spjall.socket

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import samtak.spjall.account.FakeAccount
import samtak.spjall.core.Event
import samtak.spjall.core.Outcome
import kotlin.random.Random

@OptIn(ExperimentalCoroutinesApi::class)
class SocketTest {
    private val dispatcher = StandardTestDispatcher()
    private val account = FakeAccount(signedIn = true)
    private val wire = FakeWire()

    // Every wait is the lower end of its range.
    private val noJitter =
        object : Random() {
            override fun nextBits(bitCount: Int) = 0
        }

    private fun TestScope.socket() = Socket(account, wire, backgroundScope, dispatcher, noJitter)

    @Test
    fun syncsWhenItConnectsAndSendsWhatTheSyncReturns() =
        runTest(dispatcher) {
            val socket = socket()
            val events = mutableListOf<Event>()
            backgroundScope.launch { socket.events.collect(events::add) }
            account.outcomes += Outcome(listOf(Event.Joined("c1")), listOf("""{"type":"ack"}"""))
            socket.start()
            runCurrent()
            assertEquals(listOf("t1"), wire.tokens)
            assertEquals(Connection.Connecting, socket.connection.value)

            wire.signal(Signal.Opened)
            runCurrent()
            assertEquals(Connection.Online, socket.connection.value)
            assertTrue("sync" in account.calls)
            assertEquals(listOf("""{"type":"ack"}"""), wire.sent)
            assertEquals(listOf<Event>(Event.Joined("c1")), events)
        }

    @Test
    fun passesEachFrameToTheCoreAndSendsItsAnswer() =
        runTest(dispatcher) {
            socket().start()
            runCurrent()
            wire.signal(Signal.Opened)
            runCurrent()
            account.outcomes += Outcome(emptyList(), listOf("""{"type":"pong"}"""))
            wire.signal(Signal.Frame("""{"type":"ping"}"""))
            runCurrent()
            assertTrue("""onFrame {"type":"ping"}""" in account.calls)
            assertEquals(listOf("""{"type":"pong"}"""), wire.sent)
        }

    @Test
    fun reconnectsAfterAWaitThatGrowsWhileItCannotConnect() =
        runTest(dispatcher) {
            val socket = socket()
            socket.start()
            runCurrent()
            wire.signal(Signal.Closed)
            runCurrent()
            assertEquals(Connection.Offline, socket.connection.value)
            assertEquals(1, wire.closes)

            // The first wait is 0.5 to 1 s.
            advanceTimeBy(499)
            assertEquals(1, wire.tokens.size)
            advanceTimeBy(2)
            assertEquals(2, wire.tokens.size)
            assertEquals(Connection.Connecting, socket.connection.value)

            // It never opened: the next wait is 1 to 2 s.
            wire.signal(Signal.Closed)
            runCurrent()
            advanceTimeBy(999)
            assertEquals(2, wire.tokens.size)
            advanceTimeBy(2)
            assertEquals(3, wire.tokens.size)
        }

    @Test
    fun aSocketThatOpenedStartsTheWaitsOver() =
        runTest(dispatcher) {
            socket().start()
            runCurrent()
            wire.signal(Signal.Closed)
            advanceTimeBy(501)
            wire.signal(Signal.Opened)
            runCurrent()
            wire.signal(Signal.Closed)
            runCurrent()
            advanceTimeBy(501)
            assertEquals(3, wire.tokens.size)
        }

    @Test
    fun opensNothingWhenSignedOut() =
        runTest(dispatcher) {
            account.token = null
            socket().start()
            runCurrent()
            assertEquals(emptyList<String>(), wire.tokens)
        }

    @Test
    fun startingTwiceOpensOneSocketAndStopClosesIt() =
        runTest(dispatcher) {
            val socket = socket()
            socket.start()
            socket.start()
            runCurrent()
            assertEquals(1, wire.tokens.size)
            socket.stop()
            runCurrent()
            assertEquals(1, wire.closes)
            socket.start()
            runCurrent()
            assertEquals(2, wire.tokens.size)
        }

    @Test
    fun aFailedSyncSendsNothingAndKeepsTheSocket() =
        runTest(dispatcher) {
            val socket = socket()
            socket.start()
            runCurrent()
            account.failNext = samtak.spjall.account.unreachable()
            wire.signal(Signal.Opened)
            runCurrent()
            assertEquals(Connection.Online, socket.connection.value)
            assertEquals(emptyList<String>(), wire.sent)
        }
}

/** Records what the socket asks of the wire; [signal] plays the server. */
class FakeWire : Wire {
    val tokens = mutableListOf<String>()
    val sent = mutableListOf<String>()
    var closes = 0
    private var on: (Signal) -> Unit = {}

    override fun open(
        token: String,
        on: (Signal) -> Unit,
    ): Link {
        tokens += token
        this.on = on
        return object : Link {
            override fun send(frame: String) {
                sent += frame
            }

            override fun close() {
                closes += 1
            }
        }
    }

    fun signal(signal: Signal) = on(signal)
}
