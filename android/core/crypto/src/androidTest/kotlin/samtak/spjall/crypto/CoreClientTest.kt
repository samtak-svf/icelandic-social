package samtak.spjall.crypto

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import samtak.spjall.core.Body
import samtak.spjall.core.CoreClient
import samtak.spjall.core.Event
import java.io.File
import java.util.UUID

/**
 * The core's client from Kotlin, as the app will call it (decision 0018):
 * two devices, each with its own store and a Kotlin `Transport`, exchange
 * one message.
 */
@RunWith(AndroidJUnit4::class)
class CoreClientTest {
    private val relay = Relay()

    private fun phone(
        account: String,
        device: String,
    ): CoreClient {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val dir = File(context.cacheDir, UUID.randomUUID().toString()).apply { mkdirs() }
        val client = CoreClient.open(dir.path, ByteArray(32) { 7 }, relay.link(account, device))
        // The app registers this key with POST /v1/devices first.
        assertEquals(32, client.deviceKey().size)
        client.registered(account, device)
        assertEquals(2u, client.stockKeyPackages(2u))
        return client
    }

    private fun deliver(
        client: CoreClient,
        device: String,
    ): List<Event> = relay.frames(device).flatMap { client.onFrame(it).events }

    @Test
    fun twoDevicesExchangeAMessage() {
        val a = phone("a", "a1")
        val b = phone("b", "b1")

        val conversation = a.createConversation(listOf("b"))
        a.sync()
        assertEquals(listOf(Event.Joined(conversation)), deliver(b, "b1"))

        val id = a.send(conversation, Body.Text("halló"))
        a.sync()
        val events = deliver(b, "b1")
        val message = (events.single() as Event.Message).message
        assertEquals(id, message.envelope.id)
        assertEquals(Body.Text("halló"), message.envelope.body)
        assertEquals("a", message.senderAccount)
        assertEquals("a1", message.senderDevice)
        assertTrue(b.history(conversation, null, 10u).any { it.envelope.id == id })
    }
}
