package samtak.spjall.account

import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test
import samtak.spjall.core.HttpMethod
import samtak.spjall.core.HttpRequest
import samtak.spjall.core.TransportException
import java.io.File
import java.util.concurrent.TimeUnit

class OkHttpTransportTest {
    private val server = MockWebServer()
    private val token = "aB3_-".repeat(8)

    @Before fun start() = server.start()

    @After fun stop() = server.close()

    private val floors = mutableListOf<String>()

    private fun transport() = OkHttpTransport(server.url("/").toString(), OkHttpClient(), floors::add)

    @Test
    fun sendsTheCoresRequestAsItIs() {
        server.enqueue(MockResponse(code = 200, body = """{"seq":1}"""))
        val response =
            transport().request(
                HttpRequest(HttpMethod.POST, "/v1/conversations/c1/messages", """{"a":1}""", token, "android/0.2.0"),
            )
        assertEquals(200.toUShort(), response.status)
        assertEquals("""{"seq":1}""", response.body)

        val sent = server.takeRequest()
        assertEquals("POST", sent.method)
        assertEquals("/v1/conversations/c1/messages", sent.url.encodedPath)
        assertEquals("Bearer $token", sent.headers["Authorization"])
        assertEquals("android/0.2.0", sent.headers["Spjall-Client"])
        assertEquals("application/json; charset=utf-8", sent.headers["Content-Type"])
        assertEquals("""{"a":1}""", sent.body?.utf8())
    }

    @Test
    fun keepsTheQueryAndSendsNoBearerWithoutOne() {
        server.enqueue(MockResponse(code = 200, body = "{}"))
        transport().request(HttpRequest(HttpMethod.GET, "/v1/conversations/c1/messages?after=4", null, null, null))
        val sent = server.takeRequest()
        assertEquals("GET", sent.method)
        assertEquals("after=4", sent.url.encodedQuery)
        assertNull(sent.headers["Authorization"])
    }

    @Test
    fun aBuildBelowTheFloorIsAnAnswerAndIsHeard() {
        server.enqueue(MockResponse(code = 426, body = """{"error":"client_too_old","minVersion":"0.3.0"}"""))
        server.enqueue(MockResponse(code = 426, body = "not json"))
        val response = transport().request(HttpRequest(HttpMethod.GET, "/v1/me", null, token, "android/0.2.0"))
        assertEquals(426.toUShort(), response.status)
        transport().request(HttpRequest(HttpMethod.GET, "/v1/me", null, token, "android/0.2.0"))
        assertEquals(listOf("0.3.0"), floors)
    }

    @Test
    fun anErrorStatusIsAnAnswerForTheCore() {
        server.enqueue(MockResponse(code = 403, body = """{"error":"not_a_member"}"""))
        val response = transport().request(HttpRequest(HttpMethod.DELETE, "/v1/devices/d2", null, token, null))
        assertEquals(403.toUShort(), response.status)
        assertEquals("""{"error":"not_a_member"}""", response.body)
    }

    @Test
    fun aPutWithoutAFileSendsAnEmptyBody() {
        server.enqueue(MockResponse(code = 204))
        val response = transport().request(HttpRequest(HttpMethod.PUT, "/v1/blocks/b1", null, token, null))
        assertEquals(204.toUShort(), response.status)
        assertEquals("PUT", server.takeRequest().method)
    }

    @Test
    fun aFileGoesUpAsItsBytes() {
        server.enqueue(MockResponse(code = 204))
        val file = File.createTempFile("blob", null).apply { writeBytes(byteArrayOf(0, 1, 2)) }
        val request = HttpRequest(HttpMethod.PUT, "/v1/conversations/c1/media/m1", null, token, null)
        assertEquals(204.toUShort(), transport().upload(request, file.path).status)
        val sent = server.takeRequest()
        assertEquals("PUT", sent.method)
        assertEquals("application/octet-stream", sent.headers["Content-Type"])
        assertEquals("Bearer $token", sent.headers["Authorization"])
        assertEquals(listOf<Byte>(0, 1, 2), sent.body?.toByteArray()?.toList())
    }

    @Test
    fun aFileComesDownIntoItsPathAndAnErrorLeavesNone() {
        server.enqueue(MockResponse(code = 200, body = "blob"))
        server.enqueue(MockResponse(code = 404, body = """{"error":"not_found"}"""))
        val to = File.createTempFile("down", null).apply { delete() }
        val request = HttpRequest(HttpMethod.GET, "/v1/conversations/c1/media/m1", null, token, null)
        assertEquals(200.toUShort(), transport().download(request, to.path).status)
        assertEquals("blob", to.readText())

        to.delete()
        val missing = transport().download(request, to.path)
        assertEquals(404.toUShort(), missing.status)
        assertEquals("""{"error":"not_found"}""", missing.body)
        assertEquals(false, to.exists())
    }

    @Test
    fun noAnswerIsUnreachableAndNamesNoUrl() {
        val dead =
            OkHttpTransport("http://127.0.0.1:1", OkHttpClient.Builder().connectTimeout(1, TimeUnit.SECONDS).build())
        val e =
            assertThrows(TransportException.Unreachable::class.java) {
                dead.request(HttpRequest(HttpMethod.GET, "/v1/invites/$token", null, token, null))
            }
        assertEquals("ConnectException", e.detail)
    }
}
