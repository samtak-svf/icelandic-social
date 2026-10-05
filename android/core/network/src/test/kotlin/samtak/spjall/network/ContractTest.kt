package samtak.spjall.network

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Test
import samtak.spjall.api.HelloFrame
import samtak.spjall.api.NotifyFrame
import samtak.spjall.api.PingFrame
import samtak.spjall.api.WsFrame
import samtak.spjall.api.rest.models.Health

/** The generated Kotlin types read what the Worker writes (api/openapi.json). */
class ContractTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun healthParses() {
        val body = """{"status":"ok","minClientVersion":{"android":"1.4.0","ios":"1.3.0"},"later":1}"""
        val health = json.decodeFromString<Health>(body)
        assertEquals("ok", health.status.value)
        assertEquals("1.4.0", health.minClientVersion.android)
        assertEquals("1.3.0", health.minClientVersion.ios)
    }

    @Test
    fun framesRoundTripTaggedByType() {
        val frames: List<WsFrame> =
            listOf(
                HelloFrame(protocol = 1, serverTime = "2026-10-05T12:00:00Z"),
                NotifyFrame(conversationId = "c1", seq = 42),
                PingFrame(nonce = "n"),
            )
        for (frame in frames) {
            val text = json.encodeToString(WsFrame.serializer(), frame)
            assertEquals(frame, json.decodeFromString(WsFrame.serializer(), text))
        }
        val notify = json.decodeFromString(WsFrame.serializer(), """{"type":"notify","conversationId":"c2","seq":7}""")
        assertEquals(NotifyFrame(conversationId = "c2", seq = 7), notify)
    }
}
