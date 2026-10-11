package samtak.spjall.conversations

import samtak.spjall.account.Account
import samtak.spjall.core.Item
import samtak.spjall.core.Post

/** What the conversation picker is about to send, shown above the list (decision 0043). */
sealed interface Outgoing {
    /** A message forwarded (decision 0041), as its row in the conversation it comes from. */
    data class Message(
        val item: Item,
    ) : Outgoing

    /** A Fljótið post shared (decision 0040), as the server holds it now; held for the screen only. */
    data class SharedPost(
        val post: Post,
    ) : Outgoing

    /** The post is no longer shown: the preview says only that. */
    data object PostGone : Outgoing
}

/** The message at [seq] of [from], for the forward's preview; null when it cannot be read. */
fun forwarding(
    from: String,
    seq: ULong,
): Account.() -> Outgoing? =
    {
        timeline(from, seq + 1uL, 1u).lastOrNull { it.seq == seq }?.let(Outgoing::Message)
    }
