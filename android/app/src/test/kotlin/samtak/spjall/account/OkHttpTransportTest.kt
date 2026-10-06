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
import java.util.concurrent.TimeUnit

class OkHttpTransportTest {
    private val server = MockWebServer()
    private val token = "aB3_-".repeat(8)

    @Before fun start() = server.start()

    @After fun stop() = server.close()

    private fun transport() = OkHttpTransport(server.url("/").toString(), OkHttpClient())

    @Test
    fun sendsTheCoresRequestAsItIs() {
        server.enqueue(MockResponse(code = 200, body = """{"seq":1}"""))
        val response =
            transport().request(HttpRequest(HttpMethod.POST, "/v1/conversations/c1/messages", """{"a":1}""", token))
        assertEquals(200.toUShort(), response.status)
        assertEquals("""{"seq":1}""", response.body)

        val sent = server.takeRequest()
        assertEquals("POST", sent.method)
        assertEquals("/v1/conversations/c1/messages", sent.url.encodedPath)
        assertEquals("Bearer $token", sent.headers["Authorization"])
        assertEquals("application/json; charset=utf-8", sent.headers["Content-Type"])
        assertEquals("""{"a":1}""", sent.body?.utf8())
    }

    @Test
    fun keepsTheQueryAndSendsNoBearerWithoutOne() {
        server.enqueue(MockResponse(code = 200, body = "{}"))
        transport().request(HttpRequest(HttpMethod.GET, "/v1/conversations/c1/messages?after=4", null, null))
        val sent = server.takeRequest()
        assertEquals("GET", sent.method)
        assertEquals("after=4", sent.url.encodedQuery)
        assertNull(sent.headers["Authorization"])
    }

    @Test
    fun anErrorStatusIsAnAnswerForTheCore() {
        server.enqueue(MockResponse(code = 403, body = """{"error":"not_a_member"}"""))
        val response = transport().request(HttpRequest(HttpMethod.DELETE, "/v1/devices/d2", null, token))
        assertEquals(403.toUShort(), response.status)
        assertEquals("""{"error":"not_a_member"}""", response.body)
    }

    @Test
    fun noAnswerIsUnreachableAndNamesNoUrl() {
        val dead =
            OkHttpTransport("http://127.0.0.1:1", OkHttpClient.Builder().connectTimeout(1, TimeUnit.SECONDS).build())
        val e =
            assertThrows(TransportException.Unreachable::class.java) {
                dead.request(HttpRequest(HttpMethod.GET, "/v1/invites/$token", null, token))
            }
        assertEquals("ConnectException", e.detail)
    }
}
