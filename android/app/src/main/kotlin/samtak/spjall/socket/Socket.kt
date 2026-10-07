package samtak.spjall.socket

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import samtak.spjall.account.Account
import samtak.spjall.core.CoreException
import samtak.spjall.core.Event
import samtak.spjall.core.Outcome
import kotlin.random.Random

/** Opens the WebSocket: OkHttp's in the app, a fake in tests. */
fun interface Wire {
    /**
     * Opens `/v1/ws` with the device [token]. [on] hears what happens on it,
     * from any thread, ending with [Signal.Closed].
     */
    fun open(
        token: String,
        on: (Signal) -> Unit,
    ): Link
}

/** One open socket. */
interface Link {
    fun send(frame: String)

    fun close()
}

sealed interface Signal {
    data object Opened : Signal

    data class Frame(
        val text: String,
    ) : Signal

    /** Closed by either side, or failed, a missed pong included. */
    data object Closed : Signal
}

/** What the list's connection line shows. */
enum class Connection { Connecting, Online, Offline }

/** What the screens read from the socket. */
interface Live {
    val connection: StateFlow<Connection>

    /** Every event the core returns, from the socket's frames and from each sync. */
    val events: SharedFlow<Event>

    /** Syncs now, as after a change the server has to hear of. */
    fun sync()
}

/**
 * The socket (decision 0022), open while the app is in the foreground: [start]
 * and [stop] follow the process lifecycle. It reconnects with jittered backoff,
 * calls `sync()` on connect, passes each frame to `on_frame`, and sends the
 * frames each `Outcome` returns. The core does the rest.
 */
class Socket(
    private val account: Account,
    private val wire: Wire,
    private val scope: CoroutineScope,
    private val io: CoroutineDispatcher = Dispatchers.IO,
    private val random: Random = Random.Default,
) : Live {
    private val _connection = MutableStateFlow(Connection.Connecting)
    override val connection: StateFlow<Connection> = _connection.asStateFlow()

    private val _events = MutableSharedFlow<Event>(extraBufferCapacity = EVENTS)
    override val events: SharedFlow<Event> = _events.asSharedFlow()

    private var job: Job? = null

    @Volatile private var link: Link? = null

    // One core call's events reach the screens before the next call's.
    private val calls = Mutex()

    /** Opens the socket and keeps it open until [stop]. Does nothing while it runs, or when signed out. */
    fun start() {
        if (job?.isActive == true) return
        job = scope.launch { run() }
    }

    fun stop() {
        job?.cancel()
        job = null
        _connection.value = Connection.Connecting
    }

    override fun sync() {
        scope.launch { deliver { account.sync() } }
    }

    private suspend fun run() {
        var failures = 0
        while (true) {
            val token =
                try {
                    withContext(io) { account.deviceToken() }
                } catch (_: CoreException) {
                    null
                } ?: return
            _connection.value = Connection.Connecting
            if (session(token)) failures = 0
            _connection.value = Connection.Offline
            delay(backoff(failures++))
        }
    }

    /** One socket, until it closes. True when it opened. */
    private suspend fun session(token: String): Boolean {
        val signals = Channel<Signal>(Channel.UNLIMITED)
        val open = wire.open(token) { signals.trySend(it) }
        var opened = false
        try {
            for (signal in signals) {
                when (signal) {
                    Signal.Opened -> {
                        opened = true
                        link = open
                        _connection.value = Connection.Online
                        deliver { account.sync() }
                    }
                    is Signal.Frame -> deliver { account.onFrame(signal.text) }
                    Signal.Closed -> break
                }
            }
        } finally {
            link = null
            open.close()
        }
        return opened
    }

    /** Runs one core call off the main thread, sends its frames and hands its events on. */
    private suspend fun deliver(call: () -> Outcome) {
        calls.withLock {
            // A failed call changed nothing; the next sync or frame tries again.
            val outcome =
                try {
                    withContext(io) { call() }
                } catch (_: CoreException) {
                    return
                }
            outcome.frames.forEach { frame -> link?.send(frame) }
            outcome.events.forEach { _events.emit(it) }
        }
    }

    /** Doubling from 1 s to 30 s, each wait drawn from its upper half so that devices spread out. */
    private fun backoff(failures: Int): Long {
        val ceiling = minOf(MAX_WAIT_MS, FIRST_WAIT_MS shl minOf(failures, DOUBLINGS))
        return ceiling / 2 + random.nextLong(ceiling / 2 + 1)
    }

    private companion object {
        const val EVENTS = 64
        const val FIRST_WAIT_MS = 1_000L
        const val MAX_WAIT_MS = 30_000L
        const val DOUBLINGS = 5
    }
}
