package samtak.spjall.socket

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import samtak.spjall.account.Account
import samtak.spjall.account.FakeAccount
import samtak.spjall.core.Content
import samtak.spjall.core.Conversation
import samtak.spjall.core.ConversationState
import samtak.spjall.core.Event
import samtak.spjall.core.Item
import samtak.spjall.core.ItemStatus
import samtak.spjall.core.Outcome
import samtak.spjall.core.Person
import samtak.spjall.core.Reaction

/**
 * The socket as the view models see it. [perform] runs the call on [account]
 * at once and records nothing else; [syncs] counts the syncs asked for.
 */
class FakeLive(
    private val account: Account = FakeAccount(signedIn = true),
) : Live {
    override val connection = MutableStateFlow(Connection.Connecting)
    override val events = MutableSharedFlow<Event>(extraBufferCapacity = 16)
    var syncs = 0
    val sent = mutableListOf<String>()

    override fun sync() {
        syncs += 1
    }

    override fun perform(call: (Account) -> Outcome) {
        call(account).events.forEach { events.tryEmit(it) }
    }

    override suspend fun performAndWait(call: (Account) -> Outcome) = perform(call)

    override fun send(frame: String) {
        sent += frame
    }
}

fun person(
    account: String,
    name: String? = null,
    verified: Boolean = name != null,
) = Person(account, name, verified)

fun conversation(
    id: String,
    vararg members: Person,
    state: ConversationState = ConversationState.ACTIVE,
) = Conversation(id, state, members.toList(), null, 0u, null)

/** A sent text from [sender] at [ts], its envelope id taken from [seq]. */
fun item(
    seq: ULong?,
    text: String = "m$seq",
    sender: Person = person("a2", "Anna"),
    own: Boolean = false,
    ts: ULong = 1_700_000_000_000uL + (seq ?: 0uL) * 1_000uL,
    status: ItemStatus = ItemStatus.SENT,
    content: Content = Content.Text(text, null),
    reactions: List<Reaction> = emptyList(),
    readBy: UInt = 0u,
    expiresAt: ULong? = null,
) = Item(seq, seq?.let { "e$it" }, sender, own, ts, status, content, false, reactions, readBy, expiresAt)
