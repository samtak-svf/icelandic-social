package samtak.spjall.account

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import samtak.spjall.core.HttpMethod
import samtak.spjall.core.HttpRequest
import samtak.spjall.core.HttpResponse
import samtak.spjall.core.Transport
import samtak.spjall.core.TransportException
import java.io.File
import java.io.IOException

/**
 * The core's HTTP (decision 0018): it builds every request and reads every
 * answer, and this only carries them. The core calls it on the thread that
 * called the core, so it blocks. Any status is an answer and goes back to the
 * core as one; only no answer at all is `Unreachable`. Nothing here logs: the
 * bearer is a device token, and paths can carry an invite token. Files
 * (decision 0023) go by path both ways and are streamed, never held whole.
 * A 426 also goes to [tooOld] with the minimum version (decision 0030), since
 * the core meets it on paths whose errors the app never sees.
 */
class OkHttpTransport(
    baseUrl: String,
    private val http: OkHttpClient,
    private val tooOld: (String) -> Unit = {},
) : Transport {
    private val base = baseUrl.trimEnd('/')

    override fun request(request: HttpRequest): HttpResponse =
        carry(request, request.body?.toRequestBody(JSON) ?: emptyBodyFor(request.method), ::answer)

    override fun upload(
        request: HttpRequest,
        path: String,
    ): HttpResponse = carry(request, File(path).asRequestBody(OCTETS), ::answer)

    // Only a 200 is the file; any other answer is the core's to read.
    override fun download(
        request: HttpRequest,
        to: String,
    ): HttpResponse =
        carry(request, null) { response ->
            if (response.code != OK) return@carry answer(response)
            response.body.byteStream().use { from -> File(to).outputStream().use { from.copyTo(it) } }
            HttpResponse(response.code.toUShort(), "")
        }

    private fun answer(response: Response): HttpResponse {
        val body = response.body.string()
        if (response.code == UPGRADE_REQUIRED) minVersion(body)?.let(tooOld)
        return HttpResponse(response.code.toUShort(), body)
    }

    private fun minVersion(body: String): String? =
        runCatching { Json.parseToJsonElement(body) }
            .getOrNull()
            .let { (it as? JsonObject)?.get("minVersion") as? JsonPrimitive }
            ?.takeIf { it.isString }
            ?.content
            ?.ifEmpty { null }

    private fun carry(
        request: HttpRequest,
        body: RequestBody?,
        read: (Response) -> HttpResponse,
    ): HttpResponse {
        val call =
            Request
                .Builder()
                .url(base + request.path)
                .method(request.method.name, body)
                .apply { request.bearer?.let { header("Authorization", "Bearer $it") } }
                .apply { request.client?.let { header("Spjall-Client", it) } }
                .build()
        return try {
            http.newCall(call).execute().use(read)
        } catch (
            // The cause stays behind on purpose: its message can hold the URL,
            // and a path can carry an invite token. The class name says what
            // failed (timeout, DNS, TLS) without it.
            @Suppress("SwallowedException") e: IOException,
        ) {
            throw TransportException.Unreachable(e.javaClass.simpleName)
        }
    }

    // OkHttp wants a body on POST and PUT; the core sends one on every POST
    // it makes and on the push token's PUT, and its other PUTs carry none.
    private fun emptyBodyFor(method: HttpMethod) =
        if (method == HttpMethod.POST || method == HttpMethod.PUT) "".toRequestBody(JSON) else null

    private companion object {
        val JSON = "application/json".toMediaType()
        val OCTETS = "application/octet-stream".toMediaType()
        const val OK = 200
        const val UPGRADE_REQUIRED = 426
    }
}
