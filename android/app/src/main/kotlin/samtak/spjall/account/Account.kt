package samtak.spjall.account

import samtak.spjall.core.CoreClient
import samtak.spjall.core.Inviter
import samtak.spjall.core.Me
import samtak.spjall.core.Platform

/**
 * What the sign-in and "Ég" screens ask of the core (decisions 0018, 0019).
 * Every call blocks on the store or the network, so callers run it off the
 * main thread. The view models depend on this rather than on [CoreClient],
 * so their tests need no native library.
 */
interface Account {
    fun signedIn(): Boolean

    /** The Kenni URL to open in a Custom Tab. */
    fun beginSignIn(): String

    /** `Unreachable` leaves the sign-in pending, so the same callback can be tried again. */
    fun completeSignIn(
        callback: String,
        inviteToken: String?,
    )

    /** Tops up this device's KeyPackages, so other accounts can add it to a conversation. */
    fun stockKeyPackages()

    /** Who sent an invite link: null for the operator's. A dead link is `Refused` 404. */
    fun resolveInvite(token: String): Inviter?

    fun me(): Me

    /** The link this device last made, or null before the first. */
    fun inviteLink(): String?

    /** A new link, which ends the one before. */
    fun rotateInvite(): String

    /** Revoking this device signs it out. */
    fun revokeDevice(deviceId: String)

    fun deleteAccount()
}

/** [Account] over the core's client, opened on the first call. */
class CoreAccount(
    open: () -> CoreClient,
) : Account {
    private val client by lazy(open)

    override fun signedIn() = client.signedIn() != null

    override fun beginSignIn() = client.beginSignIn()

    override fun completeSignIn(
        callback: String,
        inviteToken: String?,
    ) {
        client.completeSignIn(callback, inviteToken, Platform.ANDROID)
    }

    override fun stockKeyPackages() {
        client.stockKeyPackages(KEY_PACKAGES)
    }

    override fun resolveInvite(token: String) = client.resolveInvite(token)

    override fun me() = client.me()

    override fun inviteLink() = client.inviteLink()

    override fun rotateInvite() = client.rotateInvite()

    override fun revokeDevice(deviceId: String) = client.revokeDevice(deviceId)

    override fun deleteAccount() = client.deleteAccount()

    private companion object {
        // Each account that starts a conversation with this one claims one.
        // When they run out, the last-resort KeyPackage still answers, and
        // the next launch tops the stock up again.
        const val KEY_PACKAGES = 10u
    }
}
