package samtak.spjall.crypto

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import samtak.spjall.core.Body
import samtak.spjall.core.Content
import samtak.spjall.core.CoreClient
import samtak.spjall.core.CoreException
import samtak.spjall.core.Event
import samtak.spjall.core.NoticeKind
import samtak.spjall.core.Platform
import samtak.spjall.core.SignInProvider
import samtak.spjall.core.SignedIn
import java.io.File
import java.util.UUID

/**
 * The core's client from Kotlin, as the app will call it (decisions 0018
 * and 0019): two devices, each with its own store and a Kotlin `Transport`,
 * sign in and exchange a message and a sealed file (0023), and one is
 * shown a notice for it and hands its push token to the server (0025).
 * Every request names the build, and one below the floor is told (0030).
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
        val client =
            CoreClient.open(dir.path, ByteArray(32) { 7 }, relay.link(account, device), Platform.ANDROID, "0.2.0")
        assertEquals(null, client.signedIn())
        // The app opens this URL in a Custom Tab and is handed the callback.
        val callback = Relay.kenni(client.beginSignIn(SignInProvider.KENNI))
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
    fun aNewMessageIsNoticedOnceAndThePushTokenReachesTheServer() {
        val a = phone("a", "a1")
        val b = phone("b", "b1")
        val conversation = conversation(a, b)

        b.setPushToken("fcm-b1", false)
        b.sync()
        a.send(conversation, Body.Text("vaknaðu"))
        a.sync()
        deliver(b, "b1")
        assertEquals("fcm-b1" to false, relay.pushToken("b1"))
        val notice = b.notices().shown.single()
        assertEquals(conversation, notice.conversation)
        assertEquals("a", notice.sender.account)
        assertEquals(NoticeKind.TEXT, notice.kind)
        assertEquals("vaknaðu", notice.text)
        assertTrue(b.notices().shown.isEmpty())
    }

    @Test
    fun aFileCrossesSealedAndOpensOnTheOtherSide() {
        val a = phone("a", "a1")
        val b = phone("b", "b1")
        val conversation = conversation(a, b)
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val photo = ByteArray(70_000) { (it % 251).toByte() }
        val path = File(context.cacheDir, "${UUID.randomUUID()}.png").apply { writeBytes(photo) }

        a.sendMedia(conversation, path.path, "image/png", "sólarlag", "../sólarlag.png")
        a.sync()
        deliver(b, "b1")
        val item = b.timeline(conversation, null, 10u).single { it.content is Content.Media }
        // The core cuts the name to a bare one before the other side sees it.
        assertEquals(Content.Media("image/png", photo.size.toULong(), "sólarlag", "sólarlag.png"), item.content)
        val opened = File(b.media(conversation, item.seq!!))
        assertTrue(opened.readBytes().contentEquals(photo))
    }

    @Test
    fun everyRequestNamesTheBuildAndOneBelowTheFloorIsTold() {
        val a = phone("a", "a1")
        assertEquals("android/0.2.0", a.clientHeader())
        a.sync()
        assertTrue(relay.clients().all { it == "android/0.2.0" })

        relay.floor = "0.3.0"
        val refused = assertThrows(CoreException.ClientTooOld::class.java) { a.sync() }
        assertEquals("0.3.0", refused.minVersion)
    }
}
