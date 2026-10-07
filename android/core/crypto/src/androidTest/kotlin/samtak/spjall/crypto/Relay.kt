package samtak.spjall.crypto

import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import samtak.spjall.core.HttpMethod
import samtak.spjall.core.HttpRequest
import samtak.spjall.core.HttpResponse
import samtak.spjall.core.Transport
import java.io.File

/**
 * The delivery service in memory, as far as two clients exchanging one
 * message need it: sign-in, KeyPackages, conversations with a roster,
 * messages by seq, Welcomes, and a notify frame to every member's device.
 * Signing in hands a link's device the token `token-<device>`, and every
 * other route answers 401 without it. A commit's claim (decision 0020) is
 * found as the JSON text it is in the message's clear authenticated_data,
 * and moves the roster and names the Welcome's recipients. Media blobs
 * (decision 0023) are kept by path for the roster, and a device's push
 * token (0025) by device. The real rules live in
 * the Worker and in the core's own relay.
 */
class Relay {
    private class Stored(
        val seq: Long,
        val sender: String,
        val clientMsgId: String,
        val ciphertext: String,
    )

    private class Welcome(
        val seq: Long,
        val message: String,
        val to: List<String>,
    )

    private class Conversation(
        creator: String,
    ) {
        val roster = mutableSetOf(creator)
        val messages = mutableListOf<Stored>()
        val welcomes = mutableListOf<Welcome>()
    }

    private val devices = mutableMapOf<String, String>()
    private val packages = mutableMapOf<String, ArrayDeque<String>>()
    private val conversations = mutableMapOf<String, Conversation>()
    private val frames = mutableMapOf<String, MutableList<String>>()
    private val media = mutableMapOf<String, ByteArray>()
    private val push = mutableMapOf<String, Pair<String, Boolean>>()

    fun link(
        account: String,
        device: String,
    ): Transport {
        synchronized(this) { devices[device] = account }
        return object : Transport {
            override fun request(request: HttpRequest): HttpResponse =
                synchronized(this@Relay) { handle(account, device, request) }

            override fun upload(
                request: HttpRequest,
                path: String,
            ): HttpResponse {
                val blob = File(path).readBytes()
                return synchronized(this@Relay) {
                    refusal(account, device, request)
                        ?: if (media.putIfAbsent(request.path, blob) != null) refuse(409, "conflict") else NO_CONTENT
                }
            }

            override fun download(
                request: HttpRequest,
                to: String,
            ): HttpResponse =
                synchronized(this@Relay) {
                    refusal(account, device, request)
                        ?: media[request.path]?.let {
                            File(to).writeBytes(it)
                            HttpResponse(200u, "")
                        }
                        ?: refuse(404, "not_found")
                }
        }
    }

    /** What a media request is refused with, or null when its device may make it. */
    private fun refusal(
        account: String,
        device: String,
        request: HttpRequest,
    ): HttpResponse? {
        if (request.bearer != "token-$device") return refuse(401, "unauthorized")
        val parts = request.path.removePrefix("/v1/").split('/')
        if (parts.size != 4 || parts[0] != "conversations" || parts[2] != "media") return refuse(404, "not_found")
        val conversation = conversations[parts[1]] ?: return refuse(404, "not_found")
        return if (account in conversation.roster) null else refuse(403, "not_a_member")
    }

    /** The push token a device last set, and whether it is a sandbox one. */
    fun pushToken(device: String): Pair<String, Boolean>? = synchronized(this) { push[device] }

    /** The frames waiting on a device's socket, oldest first. */
    fun frames(device: String): List<String> = synchronized(this) { frames.remove(device).orEmpty() }

    private fun handle(
        account: String,
        device: String,
        request: HttpRequest,
    ): HttpResponse {
        val body = request.body?.let(::JSONObject) ?: JSONObject()
        val path = request.path.substringBefore('?')
        val after = request.path.substringAfter("after=", "0").toLong()
        val parts = path.removePrefix("/v1/").split('/')
        val token = "token-$device"
        when {
            request.method == HttpMethod.GET && parts == listOf("sign-in") -> return ok(SIGN_IN)
            request.method == HttpMethod.POST && parts == listOf("devices") -> {
                if (body.optString("kenniCode").isEmpty() || body.optString("codeVerifier").isEmpty()) {
                    return refuse(400, "bad_request")
                }
                return ok(JSONObject().put("accountId", account).put("deviceId", device).put("token", token))
            }
            request.bearer != token -> return refuse(401, "unauthorized")
        }
        return when {
            request.method == HttpMethod.POST && parts == listOf("key-packages") -> {
                val queue = packages.getOrPut(device) { ArrayDeque() }
                body.getJSONArray("keyPackages").strings().forEach(queue::addLast)
                ok(JSONObject().put("available", queue.size))
            }
            request.method == HttpMethod.POST && parts.size == 3 && parts[0] == "accounts" -> {
                val claimed = JSONArray()
                devices.filter { (other, owner) -> owner == parts[1] && other != device }.keys.forEach { other ->
                    packages[other]?.removeFirstOrNull()?.let {
                        claimed.put(JSONObject().put("deviceId", other).put("keyPackage", it))
                    }
                }
                ok(JSONObject().put("keyPackages", claimed))
            }
            request.method == HttpMethod.PUT && parts.size == 3 && parts[0] == "devices" && parts[2] == "push" -> {
                if (parts[1] != device) return refuse(403, "not_this_device")
                push[device] = body.getString("token") to body.optBoolean("sandbox")
                NO_CONTENT
            }
            request.method == HttpMethod.POST && parts == listOf("conversations") -> {
                val id = body.getString("conversationId")
                conversations.getOrPut(id) { Conversation(account) }
                ok(JSONObject().put("conversationId", id))
            }
            parts.size == 3 && parts[0] == "conversations" -> {
                val conversation = conversations[parts[1]] ?: return refuse(404, "not_found")
                if (account !in conversation.roster) return refuse(403, "not_a_member")
                when {
                    request.method == HttpMethod.POST && parts[2] == "messages" ->
                        send(account, parts[1], conversation, body)
                    parts[2] == "messages" -> {
                        val rows = conversation.messages.filter { it.seq > after }
                        val messages = JSONArray()
                        rows.forEach { messages.put(JSONObject().put("seq", it.seq).put("ciphertext", it.ciphertext)) }
                        ok(JSONObject().put("messages", messages).put("more", false))
                    }
                    parts[2] == "welcome" -> {
                        val welcome =
                            conversation.welcomes.lastOrNull { account in it.to } ?: return refuse(404, "not_found")
                        ok(JSONObject().put("seq", welcome.seq).put("welcome", welcome.message))
                    }
                    else -> refuse(404, "not_found")
                }
            }
            else -> refuse(404, "not_found")
        }
    }

    private fun send(
        account: String,
        id: String,
        conversation: Conversation,
        body: JSONObject,
    ): HttpResponse {
        val clientMsgId = body.getString("clientMsgId")
        conversation.messages.firstOrNull { it.sender == account && it.clientMsgId == clientMsgId }?.let {
            return ok(JSONObject().put("seq", it.seq))
        }
        val seq = (conversation.messages.lastOrNull()?.seq ?: 0) + 1
        conversation.messages += Stored(seq, account, clientMsgId, body.getString("ciphertext"))
        val before = conversation.roster.toSet()
        claim(body.getString("ciphertext"))?.let { claim ->
            conversation.roster.clear()
            conversation.roster += claim.getJSONArray("roster").strings()
            body.optJSONObject("welcome")?.let {
                conversation.welcomes += Welcome(seq, it.getString("message"), claim.getJSONArray("welcome").strings())
            }
        }
        val frame =
            JSONObject()
                .put("type", "notify")
                .put("conversationId", id)
                .put("seq", seq)
                .toString()
        devices.filterValues { it in before || it in conversation.roster }.keys.forEach {
            frames.getOrPut(it) { mutableListOf() } += frame
        }
        return ok(JSONObject().put("seq", seq))
    }

    /** A commit's claim, or null for a message that carries none. */
    private fun claim(ciphertext: String): JSONObject? {
        val text = String(Base64.decode(ciphertext, Base64.DEFAULT), Charsets.ISO_8859_1)
        val start = text.indexOf("{\"roster\":").takeIf { it >= 0 } ?: return null
        return JSONObject(text.substring(start, text.indexOf('}', start) + 1))
    }

    private fun ok(body: JSONObject) = HttpResponse(200u, body.toString())

    private fun refuse(
        status: Int,
        code: String,
    ) = HttpResponse(status.toUShort(), JSONObject().put("error", code).toString())

    private fun JSONArray.strings() = List(length(), ::getString)

    companion object {
        private val NO_CONTENT = HttpResponse(204u, "")

        /** Where Kenni's callback goes, from the frozen URL scheme. */
        const val REDIRECT = "is.samtak.spjall:/kenni"

        private val SIGN_IN =
            JSONObject()
                .put("authorizationEndpoint", "https://kenni.test/oidc/auth")
                .put("clientId", "spjall")
                .put("redirectUri", REDIRECT)
                .put("scope", "openid national_id audkenni_name")

        /**
         * What the browser and Kenni do with an authorize URL: the person
         * signs in, and the app is handed the callback with a code and the
         * same `state`.
         */
        fun kenni(authorize: String): String {
            val state = authorize.substringAfter("state=").substringBefore('&')
            return "$REDIRECT?code=code-$state&state=$state"
        }
    }
}
