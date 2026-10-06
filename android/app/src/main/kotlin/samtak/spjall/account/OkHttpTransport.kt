package samtak.spjall.account

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import samtak.spjall.core.HttpMethod
import samtak.spjall.core.HttpRequest
import samtak.spjall.core.HttpResponse
import samtak.spjall.core.Transport
import samtak.spjall.core.TransportException
import java.io.IOException

/**
 * The core's HTTP (decision 0018): it builds every request and reads every
 * answer, and this only carries them. The core calls it on the thread that
 * called the core, so it blocks. Any status is an answer and goes back to the
 * core as one; only no answer at all is `Unreachable`. Nothing here logs: the
 * bearer is a device token, and paths can carry an invite token.
 */
class OkHttpTransport(
    baseUrl: String,
    private val http: OkHttpClient,
) : Transport {
    private val base = baseUrl.trimEnd('/')

    override fun request(request: HttpRequest): HttpResponse {
        val body = request.body?.toRequestBody(JSON)
        val call =
            Request
                .Builder()
                .url(base + request.path)
                .method(request.method.name, body ?: emptyBodyFor(request.method))
                .apply { request.bearer?.let { header("Authorization", "Bearer $it") } }
                .build()
        return try {
            http.newCall(call).execute().use { response ->
                HttpResponse(response.code.toUShort(), response.body.string())
            }
        } catch (
            // The cause stays behind on purpose: its message can hold the URL,
            // and a path can carry an invite token. The class name says what
            // failed (timeout, DNS, TLS) without it.
            @Suppress("SwallowedException") e: IOException,
        ) {
            throw TransportException.Unreachable(e.javaClass.simpleName)
        }
    }

    // OkHttp wants a body on POST; the core sends one on every POST it makes.
    private fun emptyBodyFor(method: HttpMethod) = if (method == HttpMethod.POST) "".toRequestBody(JSON) else null

    private companion object {
        val JSON = "application/json".toMediaType()
    }
}
