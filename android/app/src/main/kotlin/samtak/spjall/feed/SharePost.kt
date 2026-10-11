package samtak.spjall.feed

import samtak.spjall.account.Account
import samtak.spjall.conversations.Outgoing
import samtak.spjall.core.SharedPost

/**
 * What the conversation picker does in each picked conversation when a post is shared: one message
 * that carries the post's id and nothing else, never its text or author (decision 0040).
 */
fun sharing(postId: String): Account.(to: String) -> Unit = { to -> sharePost(to, postId) }

/** The post as the server holds it now, for the picker's preview; fetched while the picker is open and kept nowhere. */
fun sharedPreview(postId: String): Account.() -> Outgoing? =
    {
        when (val shared = sharedPost(postId)) {
            is SharedPost.Found -> Outgoing.SharedPost(shared.post)
            SharedPost.Gone -> Outgoing.PostGone
        }
    }
