package samtak.spjall.account

import samtak.spjall.core.Body
import samtak.spjall.core.Conversation
import samtak.spjall.core.CoreClient
import samtak.spjall.core.Inviter
import samtak.spjall.core.Item
import samtak.spjall.core.Me
import samtak.spjall.core.Notices
import samtak.spjall.core.Outcome
import samtak.spjall.core.Person
import samtak.spjall.core.Platform
import samtak.spjall.core.Settings
import samtak.spjall.core.SignInProvider

/**
 * What the screens and the socket ask of the core (decisions 0018, 0019, 0022).
 * Every call blocks on the store or the network, so callers run it off the
 * main thread. The view models depend on this rather than on [CoreClient],
 * so their tests need no native library. It has one function per core call,
 * which is why it is long: splitting the seam would only scatter it.
 */
@Suppress("TooManyFunctions")
interface Account {
    fun signedIn(): Boolean

    /** The provider's URL to open in a Custom Tab. */
    fun beginSignIn(provider: SignInProvider): String

    /** `Unreachable` leaves the sign-in pending, so the same callback can be tried again. */
    fun completeSignIn(
        callback: String,
        inviteToken: String?,
    )

    /** The provider's URL that links it to this account (decision 0033): Kenni verifies the name. */
    fun beginLink(provider: SignInProvider): String

    /** Finishes a link with the redirect; `Refused(409, "identity_taken")` when another account holds it. */
    fun completeLink(callback: String)

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

    /** The token for the socket's upgrade; null when signed out. */
    fun deviceToken(): String?

    /** Sends what is queued and fetches what is new. */
    fun sync(): Outcome

    /**
     * Keeps the platform's push token; the next [sync] sends it if the server
     * does not have it yet (decision 0025). An unchanged token sends nothing.
     */
    fun setPushToken(
        token: String,
        sandbox: Boolean,
    )

    /** What to announce since the last call, each item once, and which conversations' notifications to take away. */
    fun notices(): Notices

    /** One text frame from the socket. */
    fun onFrame(frame: String): Outcome

    /** The conversation list, as summaries. */
    fun conversations(): List<Conversation>

    /** Everyone met through a shared conversation: the new-conversation picker. */
    fun people(): List<Person>

    /** A new conversation with these accounts; it reaches the server on the next [sync]. Returns its id. */
    fun createConversation(with: List<String>): String

    /** The 1:1 with the invite's maker, made if there is none yet. Returns its id. */
    fun openInvite(token: String): String

    /** Up to [limit] items before the seq [before], oldest first; the newest page ends with the unsent ones. */
    fun timeline(
        conversation: String,
        before: ULong?,
        limit: UInt,
    ): List<Item>

    /** Queues a message for the next [sync]. Returns its envelope id. */
    fun send(
        conversation: String,
        body: Body,
    ): String

    /** Sends the failed items of a conversation again. */
    fun retry(conversation: String): Outcome

    /** Everything up to [seq] is read; the receipt goes with the next [sync]. */
    fun markRead(
        conversation: String,
        seq: ULong,
    )

    /** The typing frame to send, or null when typing is off or one went out less than 3 s ago. */
    fun typing(
        conversation: String,
        active: Boolean,
    ): String?

    /** Deletes what has disappeared. */
    fun expire(): Outcome

    /**
     * Seals and uploads the file at [path], then sends it under [name] (0023);
     * the core keeps its own copy.
     */
    fun sendMedia(
        conversation: String,
        path: String,
        mime: String,
        caption: String?,
        name: String?,
    ): String

    /** The path of the media item at [seq], downloaded and checked the first time. */
    fun media(
        conversation: String,
        seq: ULong,
    ): String

    /** Blocks [account] (0024): it can no longer reach this one, and the 1:1 with it ends. */
    fun block(account: String): Outcome

    fun unblock(account: String)

    /** The accounts this one blocked, newest first. */
    fun blocked(): List<Person>

    fun settings(): Settings

    fun setSettings(settings: Settings)
}

/** [Account] over the core's client, opened on the first call. */
@Suppress("TooManyFunctions")
class CoreAccount(
    open: () -> CoreClient,
) : Account {
    private val client by lazy(open)

    override fun signedIn() = client.signedIn() != null

    override fun beginSignIn(provider: SignInProvider) = client.beginSignIn(provider)

    override fun completeSignIn(
        callback: String,
        inviteToken: String?,
    ) {
        client.completeSignIn(callback, inviteToken, Platform.ANDROID)
    }

    override fun beginLink(provider: SignInProvider) = client.beginLink(provider)

    override fun completeLink(callback: String) = client.completeLink(callback)

    override fun stockKeyPackages() {
        client.stockKeyPackages(KEY_PACKAGES)
    }

    override fun resolveInvite(token: String) = client.resolveInvite(token)

    override fun me() = client.me()

    override fun inviteLink() = client.inviteLink()

    override fun rotateInvite() = client.rotateInvite()

    override fun revokeDevice(deviceId: String) = client.revokeDevice(deviceId)

    override fun deleteAccount() = client.deleteAccount()

    override fun deviceToken() = client.deviceToken()

    override fun sync() = client.sync()

    override fun setPushToken(
        token: String,
        sandbox: Boolean,
    ) = client.setPushToken(token, sandbox)

    override fun notices() = client.notices()

    override fun onFrame(frame: String) = client.onFrame(frame)

    override fun conversations() = client.conversations()

    override fun people() = client.people()

    override fun createConversation(with: List<String>) = client.createConversation(with)

    override fun openInvite(token: String) = client.openInvite(token)

    override fun timeline(
        conversation: String,
        before: ULong?,
        limit: UInt,
    ) = client.timeline(conversation, before, limit)

    override fun send(
        conversation: String,
        body: Body,
    ) = client.send(conversation, body)

    override fun retry(conversation: String) = client.retry(conversation)

    override fun markRead(
        conversation: String,
        seq: ULong,
    ) = client.markRead(conversation, seq)

    override fun typing(
        conversation: String,
        active: Boolean,
    ) = client.typing(conversation, active)

    override fun expire() = client.expire()

    override fun sendMedia(
        conversation: String,
        path: String,
        mime: String,
        caption: String?,
        name: String?,
    ) = client.sendMedia(conversation, path, mime, caption, name)

    override fun media(
        conversation: String,
        seq: ULong,
    ) = client.media(conversation, seq)

    override fun block(account: String) = client.block(account)

    override fun unblock(account: String) = client.unblock(account)

    override fun blocked() = client.blocked()

    override fun settings() = client.settings()

    override fun setSettings(settings: Settings) = client.setSettings(settings)

    private companion object {
        // Each account that starts a conversation with this one claims one.
        // When they run out, the last-resort KeyPackage still answers, and
        // the next launch tops the stock up again.
        const val KEY_PACKAGES = 10u
    }
}
