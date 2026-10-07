package samtak.spjall.socket

import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

class OkHttpWireTest {
    private val server = MockWebServer()
    private val signals = LinkedBlockingQueue<Signal>()
    private val received = LinkedBlockingQueue<String>()

    @Before fun start() = server.start()

    @After fun stop() = server.close()

    private fun next() = signals.poll(5, TimeUnit.SECONDS)

    @Test
    fun opensTheSocketWithTheTokenAndCarriesFramesBothWays() {
        server.enqueue(
            MockResponse
                .Builder()
                .webSocketUpgrade(
                    object : WebSocketListener() {
                        override fun onOpen(
                            webSocket: WebSocket,
                            response: Response,
                        ) {
                            webSocket.send("""{"type":"hello"}""")
                        }

                        override fun onMessage(
                            webSocket: WebSocket,
                            text: String,
                        ) {
                            received += text
                            webSocket.close(1000, null)
                        }
                    },
                ).build(),
        )
        val link = OkHttpWire(server.url("/").toString(), OkHttpClient()).open("t1") { signals += it }

        assertEquals(Signal.Opened, next())
        assertEquals(Signal.Frame("""{"type":"hello"}"""), next())
        link.send("""{"type":"ack"}""")
        assertEquals("""{"type":"ack"}""", received.poll(5, TimeUnit.SECONDS))
        assertEquals(Signal.Closed, next())

        val upgrade = server.takeRequest()
        assertEquals("/v1/ws", upgrade.url.encodedPath)
        assertEquals("Bearer t1", upgrade.headers["Authorization"])
    }

    @Test
    fun aRefusedUpgradeIsClosed() {
        server.enqueue(MockResponse(code = 401, body = """{"error":"unauthorized"}"""))
        OkHttpWire(server.url("/").toString(), OkHttpClient()).open("t1") { signals += it }
        assertEquals(Signal.Closed, next())
    }
}
