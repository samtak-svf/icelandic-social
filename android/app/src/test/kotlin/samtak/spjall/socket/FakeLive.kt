package samtak.spjall.socket

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import samtak.spjall.core.Conversation
import samtak.spjall.core.ConversationState
import samtak.spjall.core.Event
import samtak.spjall.core.Person

/** The socket as the view models see it; [syncs] counts the syncs they asked for. */
class FakeLive : Live {
    override val connection = MutableStateFlow(Connection.Connecting)
    override val events = MutableSharedFlow<Event>(extraBufferCapacity = 16)
    var syncs = 0

    override fun sync() {
        syncs += 1
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
