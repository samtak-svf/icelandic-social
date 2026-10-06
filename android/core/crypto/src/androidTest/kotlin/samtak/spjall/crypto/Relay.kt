package samtak.spjall.crypto

import org.json.JSONArray
import org.json.JSONObject
import samtak.spjall.core.HttpMethod
import samtak.spjall.core.HttpRequest
import samtak.spjall.core.HttpResponse
import samtak.spjall.core.Transport

/**
 * The delivery service in memory, as far as two clients exchanging one
 * message need it: KeyPackages, conversations with a roster, messages by
 * seq, Welcomes, and a notify frame to every member's device. The real
 * rules live in the Worker and in the core's own relay.
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

    fun link(
        account: String,
        device: String,
    ): Transport {
        synchronized(this) { devices[device] = account }
        return object : Transport {
            override fun request(request: HttpRequest): HttpResponse =
                synchronized(this@Relay) { handle(account, device, request) }
        }
    }

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
        body.optJSONObject("roster")?.let { roster ->
            roster.optJSONArray("add")?.strings()?.let(conversation.roster::addAll)
            roster.optJSONArray("remove")?.strings()?.let(conversation.roster::removeAll)
        }
        body.optJSONObject("welcome")?.let {
            conversation.welcomes += Welcome(seq, it.getString("message"), it.getJSONArray("to").strings())
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

    private fun ok(body: JSONObject) = HttpResponse(200u, body.toString())

    private fun refuse(
        status: Int,
        code: String,
    ) = HttpResponse(status.toUShort(), JSONObject().put("error", code).toString())

    private fun JSONArray.strings() = List(length(), ::getString)
}
