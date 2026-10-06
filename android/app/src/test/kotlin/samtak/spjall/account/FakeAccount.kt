package samtak.spjall.account

import samtak.spjall.core.AccountDevice
import samtak.spjall.core.CoreException
import samtak.spjall.core.Inviter
import samtak.spjall.core.Me
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

    companion object {
        const val KENNI = "https://kenni.test/oidc/auth?state=s1"
    }
}

fun unreachable() = CoreException.Unreachable("SocketTimeoutException")
