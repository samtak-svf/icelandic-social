package samtak.spjall.socket

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit

/**
 * [Wire] over OkHttp's WebSocket. OkHttp pings on its own and fails the socket
 * when a pong is missed: Doze can end a socket without closing it (decision
 * 0022). Nothing here logs, since the upgrade carries the device token.
 */
class OkHttpWire(
    baseUrl: String,
    http: OkHttpClient,
) : Wire {
    private val url = baseUrl.trimEnd('/') + "/v1/ws"
    private val http = http.newBuilder().pingInterval(PING_SECONDS, TimeUnit.SECONDS).build()

    override fun open(
        token: String,
        on: (Signal) -> Unit,
    ): Link {
        val request =
            Request
                .Builder()
                .url(url)
                .header("Authorization", "Bearer $token")
                .build()
        val socket =
            http.newWebSocket(
                request,
                object : WebSocketListener() {
                    override fun onOpen(
                        webSocket: WebSocket,
                        response: Response,
                    ) = on(Signal.Opened)

                    override fun onMessage(
                        webSocket: WebSocket,
                        text: String,
                    ) = on(Signal.Frame(text))

                    override fun onClosing(
                        webSocket: WebSocket,
                        code: Int,
                        reason: String,
                    ) {
                        webSocket.close(NORMAL, null)
                    }

                    override fun onClosed(
                        webSocket: WebSocket,
                        code: Int,
                        reason: String,
                    ) = on(Signal.Closed)

                    override fun onFailure(
                        webSocket: WebSocket,
                        t: Throwable,
                        response: Response?,
                    ) = on(Signal.Closed)
                },
            )
        return object : Link {
            override fun send(frame: String) {
                socket.send(frame)
            }

            override fun close() {
                socket.close(NORMAL, null)
            }
        }
    }

    private companion object {
        const val PING_SECONDS = 20L
        const val NORMAL = 1000
    }
}
