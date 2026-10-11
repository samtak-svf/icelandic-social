package samtak.spjall.account

import samtak.spjall.core.AccountDevice
import samtak.spjall.core.Body
import samtak.spjall.core.Content
import samtak.spjall.core.Conversation
import samtak.spjall.core.CoreException
import samtak.spjall.core.Inviter
import samtak.spjall.core.Item
import samtak.spjall.core.ItemStatus
import samtak.spjall.core.ListSearch
import samtak.spjall.core.Me
import samtak.spjall.core.Mute
import samtak.spjall.core.MuteFor
import samtak.spjall.core.Notices
import samtak.spjall.core.Outcome
import samtak.spjall.core.Person
import samtak.spjall.core.PersonPage
import samtak.spjall.core.Platform
import samtak.spjall.core.Settings
import samtak.spjall.core.SignInProvider
import java.io.File

/**
 * The core as the view models see it, in memory. [failNext] makes the next
 * call throw instead, and [calls] records what was asked, in order.
 */
class FakeAccount(
    var signedIn: Boolean = false,
) : Account {
    val calls = mutableListOf<String>()
    var failNext: CoreException? = null

    /** A call, as [calls] records it, that fails as unreachable each time it is made. */
    var failOn: String? = null
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

    /** The directory (decision 0036): everyone else signed in. */
    var everyone = listOf<Person>()

    /** Each conversation's items, oldest first; [send] adds a pending one. */
    val timelines = mutableMapOf<String, MutableList<Item>>()
    var typingOn = true

    /** What the next [notices] returns; it is emptied once returned, as the core's is. */
    var notices = Notices(emptyList(), emptyList())

    /** What the next sync and frames return; each is used once. */
    val outcomes = ArrayDeque<Outcome>()
    private var created = 0

    private fun call(name: String) {
        calls += name
        if (name == failOn) throw unreachable()
        failNext?.let {
            failNext = null
            throw it
        }
    }

    override fun signedIn(): Boolean {
        call("signedIn")
        return signedIn
    }

    override fun beginSignIn(provider: SignInProvider): String {
        call("beginSignIn $provider")
        return url(provider)
    }

    override fun completeSignIn(
        callback: String,
        inviteToken: String?,
    ) {
        call("completeSignIn $callback ${inviteToken ?: "-"}")
        signedIn = true
    }

    /** Whether Kenni has vouched for the account's name; a link sets it. */
    var verified = true

    override fun beginLink(provider: SignInProvider): String {
        call("beginLink $provider")
        return url(provider)
    }

    /** Whether the next link joins this device to the older account holding the kennitala (decision 0035). */
    var joins = false

    override fun completeLink(callback: String): Boolean {
        call("completeLink $callback")
        verified = true
        return joins
    }

    override fun stockKeyPackages() = call("stockKeyPackages")

    override fun resolveInvite(token: String): Inviter? {
        call("resolveInvite $token")
        if (token !in inviters) throw CoreException.Refused(404u, "not_found", null)
        return inviters[token]
    }

    override fun me(): Me {
        call("me")
        return Me("a1", "Jón Jónsson", verified, devices, myPhoto)
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

    override fun setPushToken(
        token: String,
        sandbox: Boolean,
    ) = call("setPushToken $token $sandbox")

    override fun notices(): Notices {
        call("notices")
        return notices.also { notices = Notices(emptyList(), emptyList()) }
    }

    override fun onFrame(frame: String): Outcome {
        call("onFrame $frame")
        return outcomes.removeFirstOrNull() ?: Outcome(emptyList(), emptyList())
    }

    override fun conversations(): List<Conversation> {
        call("conversations")
        return conversations
    }

    /** As the core matches: the start of a name, or of a word in it after a space or a hyphen (decision 0038). */
    override fun searchConversations(query: String): List<Conversation> {
        call("searchConversations $query")
        return matching(query)
    }

    private fun matching(query: String): List<Conversation> {
        val search = query.trim().lowercase()
        return conversations.filter { c ->
            c.members.any { p ->
                val name = p.name.orEmpty().lowercase()
                name.startsWith(search) || name.contains(" $search") || name.contains("-$search")
            }
        }
    }

    /** As the core does: the conversations found, then the directory without anyone whose 1:1 is among them. */
    override fun searchList(
        query: String,
        limit: UInt,
    ): ListSearch {
        call("searchList $query")
        val found = matching(query)
        val shown = found.mapNotNull { it.members.singleOrNull()?.account }
        val people = everyone.filter { it.name.orEmpty().contains(query, ignoreCase = true) && it.account !in shown }
        return ListSearch(found, people.take(limit.toInt()))
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
        if (token !in inviters) throw CoreException.Refused(404u, "not_found", null)
        if (inviters[token] == null) throw CoreException.Invalid("the operator's invite opens no conversation")
        return "c-${inviters.getValue(token)?.accountId}"
    }

    override fun timeline(
        conversation: String,
        before: ULong?,
        limit: UInt,
    ): List<Item> {
        call("timeline $conversation ${before ?: "-"}")
        val all = timelines[conversation].orEmpty()
        val older = if (before == null) all else all.filter { it.seq != null && it.seq!! < before }
        return older.takeLast(limit.toInt())
    }

    override fun send(
        conversation: String,
        body: Body,
    ): String {
        call("send $conversation $body")
        val id = "e-sent${calls.size}"
        timelines.getOrPut(conversation) { mutableListOf() } +=
            Item(
                null,
                id,
                Person("a1", "Jón Jónsson", true),
                true,
                NOW,
                ItemStatus.PENDING,
                Content.Text((body as? Body.Text)?.text ?: body.toString(), null),
                false,
                emptyList(),
                0u,
                null,
                false,
            )
        return id
    }

    override fun retry(conversation: String): Outcome {
        call("retry $conversation")
        return Outcome(emptyList(), emptyList())
    }

    override fun markRead(
        conversation: String,
        seq: ULong,
    ) {
        call("markRead $conversation $seq")
    }

    /** Runs inside [typing], while the core makes the frame. */
    var onTyping: (() -> Unit)? = null
    private var typingMade = false

    override fun typing(
        conversation: String,
        active: Boolean,
    ): String? {
        call("typing $conversation $active")
        onTyping?.invoke()
        // Like the core: a start counts toward the throttle once it is made.
        if (active && typingMade) return null
        typingMade = active
        return if (typingOn) """{"type":"typing","active":$active}""" else null
    }

    override fun expire(): Outcome {
        call("expire")
        return outcomes.removeFirstOrNull() ?: Outcome(emptyList(), emptyList())
    }

    /** Media paths by conversation and seq; a missing one fails the download. */
    val files = mutableMapOf<Pair<String, ULong>, String>()
    var blockedPeople = mutableListOf<Person>()
    var current = Settings(readMarkers = true, typing = true)

    override fun sendMedia(
        conversation: String,
        path: String,
        mime: String,
        caption: String?,
        name: String?,
    ): String {
        call("sendMedia $conversation $mime $name ${java.io.File(path).readText()}")
        return "e-media${calls.size}"
    }

    override fun media(
        conversation: String,
        seq: ULong,
    ): String {
        call("media $conversation $seq")
        return files[conversation to seq] ?: throw CoreException.Invalid("checksum")
    }

    override fun forward(
        from: String,
        seq: ULong,
        to: String,
    ): String {
        call("forward $from $seq $to")
        return "e-forward${calls.size}"
    }

    override fun block(account: String): Outcome {
        call("block $account")
        blockedPeople.add(0, people.firstOrNull { it.account == account } ?: Person(account, null, false))
        return Outcome(emptyList(), emptyList())
    }

    override fun unblock(account: String) {
        call("unblock $account")
        blockedPeople.removeAll { it.account == account }
    }

    override fun blocked(): List<Person> {
        call("blocked")
        return blockedPeople.toList()
    }

    /** The server sets the end by its clock: here an hour or eight after [NOW]. */
    override fun mute(
        conversation: String,
        duration: MuteFor,
    ): Mute {
        call("mute $conversation $duration")
        val mute =
            when (duration) {
                MuteFor.HOUR -> Mute.Until(NOW + HOUR)
                MuteFor.EIGHT_HOURS -> Mute.Until(NOW + 8uL * HOUR)
                MuteFor.ALWAYS -> Mute.Always
            }
        conversations = conversations.map { if (it.id == conversation) it.copy(mute = mute) else it }
        return mute
    }

    override fun unmute(conversation: String) {
        call("unmute $conversation")
        conversations = conversations.map { if (it.id == conversation) it.copy(mute = Mute.Off) else it }
    }

    override fun settings(): Settings {
        call("settings")
        return current
    }

    override fun setSettings(settings: Settings) {
        call("setSettings ${settings.readMarkers} ${settings.typing}")
        current = settings
    }

    /** The page that starts at [cursor], an index; `next` is the index of the page after, as text. */
    private fun <T> page(
        all: List<T>,
        cursor: String?,
        limit: UInt,
    ): Pair<List<T>, String?> {
        val from = cursor?.toInt() ?: 0
        val to = minOf(all.size, from + limit.toInt())
        return all.subList(from, to).toList() to to.takeIf { it < all.size }?.toString()
    }

    override fun directory(
        query: String?,
        after: String?,
        limit: UInt,
    ): PersonPage {
        call("directory ${query ?: "-"} ${after ?: "-"}")
        val found = everyone.filter { query == null || it.name.orEmpty().contains(query, ignoreCase = true) }
        val (page, next) = page(found, after, limit)
        return PersonPage(page, next)
    }

    override fun openDirect(account: String): String {
        call("openDirect $account")
        if (account == ME.account || blockedPeople.any { it.account == account }) {
            throw CoreException.Invalid("no 1:1 with this account")
        }
        return "c-$account"
    }

    /** The version of this account's photo, as [me] gives it; [setPhoto] and [removePhoto] change it. */
    var myPhoto: String? = null
    private var photoVersions = 0

    /** The bytes of each photo [setPhoto] was given, read while the file was there. */
    val uploaded = mutableListOf<ByteArray>()

    /** The core's file for each account's photo, by "account/version"; one not here has none. */
    var photoFiles = mapOf<String, String>()

    override fun setPhoto(path: String): String {
        call("setPhoto")
        uploaded += File(path).readBytes()
        photoVersions += 1
        return "v$photoVersions".also { myPhoto = it }
    }

    override fun removePhoto() {
        call("removePhoto")
        myPhoto = null
    }

    override fun photo(
        account: String,
        version: String,
    ): String? {
        call("photo $account $version")
        return photoFiles["$account/$version"]
    }

    companion object {
        const val NOW = 1_700_000_000_000uL

        /** This account, as an author. */
        val ME = Person("a1", "Jón Jónsson", true)

        const val KENNI = "https://kenni.test/oidc/auth?state=s1"
        const val GOOGLE = "https://google.test/o/oauth2/auth?state=s1"

        fun url(provider: SignInProvider) =
            when (provider) {
                SignInProvider.KENNI -> KENNI
                SignInProvider.GOOGLE -> GOOGLE
            }
    }
}

fun unreachable() = CoreException.Unreachable("SocketTimeoutException")

private const val HOUR = 3_600_000uL
