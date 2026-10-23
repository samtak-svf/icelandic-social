package samtak.spjall.conversation

import androidx.compose.runtime.staticCompositionLocalOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import samtak.spjall.core.Card
import samtak.spjall.core.CardKind
import samtak.spjall.core.CardRef
import samtak.spjall.core.CoreException
import samtak.spjall.social.Social

/**
 * Resolves the posts shared into conversations (0080) to the card they show, once each: the answer is kept for
 * as long as the app runs, so scrolling a conversation does not ask the server again. [open] opens a post.
 */
class PostCards(
    private val social: Social,
    val open: (String) -> Unit,
) {
    private val known = mutableMapOf<String, Card>()

    /** The card of [postId]; null when the server could not be asked now (nothing is kept then). */
    suspend fun card(postId: String): Card? {
        synchronized(known) { known[postId] }?.let { return it }
        val ref = CardRef(CardKind.POST, postId)
        val card =
            try {
                withContext(Dispatchers.IO) { social.cards(listOf(ref)).firstOrNull() }
            } catch (_: CoreException) {
                null
            }
        if (card != null) synchronized(known) { known[postId] = card }
        return card
    }
}

/** Where a conversation's shared posts are resolved; absent, they show the fixed "gone" line. */
val LocalPostCards = staticCompositionLocalOf<PostCards?> { null }
