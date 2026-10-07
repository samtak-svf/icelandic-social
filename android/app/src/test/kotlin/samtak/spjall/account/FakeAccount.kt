package samtak.spjall.account

import samtak.spjall.core.AccountDevice
import samtak.spjall.core.Conversation
import samtak.spjall.core.CoreException
import samtak.spjall.core.Inviter
import samtak.spjall.core.Me
import samtak.spjall.core.Outcome
import samtak.spjall.core.Person
import samtak.spjall.core.Platform

/**
 * The core as the view models see it, in memory. [failNext] makes the next
 * call throw instead, and [calls] records what was asked, in order.
 */
class FakeAccount(
    var signedIn: Boolean = false,
) : Account {
    val calls = mutableListOf<String>()
    var failNext: CoreException? = null
    var inviters = mapOf<String, Inviter?>()
    var devices =
        listOf(
            AccountDevice("d1", Platform.ANDROID, 1_700_000_000_000u, current = true),
            AccountDevice("d2", Platform.IOS, 1_700_000_100_000u, current = false),
        )
    var link: String? = null
    private var links = 0
    var token: String? = "t1"
    var conversations = listOf<Conversation>()
    var people = listOf<Person>()

    /** What the next sync and frames return; each is used once. */
    val outcomes = ArrayDeque<Outcome>()
    private var created = 0

    private fun call(name: String) {
        calls += name
        failNext?.let {
            failNext = null
            throw it
        }
    }

    override fun signedIn(): Boolean {
        call("signedIn")
        return signedIn
    }

    override fun beginSignIn(): String {
        call("beginSignIn")
        return KENNI
    }

    override fun completeSignIn(
        callback: String,
        inviteToken: String?,
    ) {
        call("completeSignIn $callback ${inviteToken ?: "-"}")
        signedIn = true
    }

    override fun stockKeyPackages() = call("stockKeyPackages")

    override fun resolveInvite(token: String): Inviter? {
        call("resolveInvite $token")
        if (token !in inviters) throw CoreException.Refused(404u, "not_found")
        return inviters[token]
    }

    override fun me(): Me {
        call("me")
        return Me("a1", "Jón Jónsson", true, devices)
    }

    override fun inviteLink(): String? {
        call("inviteLink")
        return link
    }

    override fun rotateInvite(): String {
        call("rotateInvite")
        links += 1
        return "https://link.test/l/$links".also { link = it }
    }

    override fun revokeDevice(deviceId: String) {
        call("revokeDevice $deviceId")
        val current = devices.single { it.deviceId == deviceId }.current
        devices = devices.filter { it.deviceId != deviceId }
        if (current) signedIn = false
    }

    override fun deleteAccount() {
        call("deleteAccount")
        signedIn = false
    }

    override fun deviceToken(): String? {
        call("deviceToken")
        return token
    }

    override fun sync(): Outcome {
        call("sync")
        return outcomes.removeFirstOrNull() ?: Outcome(emptyList(), emptyList())
    }

    override fun onFrame(frame: String): Outcome {
        call("onFrame $frame")
        return outcomes.removeFirstOrNull() ?: Outcome(emptyList(), emptyList())
    }

    override fun conversations(): List<Conversation> {
        call("conversations")
        return conversations
    }

    override fun people(): List<Person> {
        call("people")
        return people
    }

    override fun createConversation(with: List<String>): String {
        call("createConversation ${with.joinToString(",")}")
        created += 1
        return "c-new$created"
    }

    override fun openInvite(token: String): String {
        call("openInvite $token")
        if (token !in inviters) throw CoreException.Refused(404u, "not_found")
        if (inviters[token] == null) throw CoreException.Invalid("the operator's invite opens no conversation")
        return "c-${inviters.getValue(token)?.accountId}"
    }

    companion object {
        const val KENNI = "https://kenni.test/oidc/auth?state=s1"
    }
}

fun unreachable() = CoreException.Unreachable("SocketTimeoutException")
