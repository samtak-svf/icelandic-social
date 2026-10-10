package samtak.spjall.feed

import samtak.spjall.account.Account

/**
 * What the conversation picker does in each picked conversation when a post is shared: one message
 * that carries the post's id and nothing else, never its text or author (decision 0040).
 */
fun sharing(postId: String): Account.(to: String) -> Unit = { to -> sharePost(to, postId) }
