package samtak.spjall.crypto

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import samtak.spjall.core.Body
import samtak.spjall.core.Content
import samtak.spjall.core.CoreClient
import samtak.spjall.core.Event
import samtak.spjall.core.Platform
import samtak.spjall.core.SignedIn
import java.io.File
import java.util.UUID

/**
 * The core's client from Kotlin, as the app will call it (decisions 0018
 * and 0019): two devices, each with its own store and a Kotlin `Transport`,
 * sign in and exchange a message and a sealed file (0023).
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
        assertEquals(null, client.signedIn())
        // The app opens this URL in a Custom Tab and is handed the callback.
        val callback = Relay.kenni(client.beginSignIn())
        assertEquals(SignedIn(account, device), client.completeSignIn(callback, null, Platform.ANDROID))
        assertEquals(SignedIn(account, device), client.signedIn())
        assertEquals("token-$device", client.deviceToken())
        assertEquals(2u, client.stockKeyPackages(2u))
        return client
    }

    private fun deliver(
        client: CoreClient,
        device: String,
    ): List<Event> =
        relay
            .frames(device)
            .flatMap { client.onFrame(it).events }
            .filter { it !is Event.Timeline && it !is Event.Profiles }

    private fun conversation(
        a: CoreClient,
        b: CoreClient,
    ): String {
        val conversation = a.createConversation(listOf("b"))
        a.sync()
        assertEquals(listOf(Event.Joined(conversation)), deliver(b, "b1"))
        return conversation
    }

    @Test
    fun twoDevicesExchangeAMessage() {
        val a = phone("a", "a1")
        val b = phone("b", "b1")
        val conversation = conversation(a, b)

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

    @Test
    fun aFileCrossesSealedAndOpensOnTheOtherSide() {
        val a = phone("a", "a1")
        val b = phone("b", "b1")
        val conversation = conversation(a, b)
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val photo = ByteArray(70_000) { (it % 251).toByte() }
        val path = File(context.cacheDir, "${UUID.randomUUID()}.png").apply { writeBytes(photo) }

        a.sendMedia(conversation, path.path, "image/png", "sólarlag")
        a.sync()
        deliver(b, "b1")
        val item = b.timeline(conversation, null, 10u).single { it.content is Content.Media }
        assertEquals(Content.Media("image/png", photo.size.toULong(), "sólarlag"), item.content)
        val opened = File(b.media(conversation, item.seq!!))
        assertTrue(opened.readBytes().contentEquals(photo))
    }
}
