package samtak.spjall.conversation

import java.util.concurrent.ConcurrentHashMap

/**
 * The unsent text of each conversation's composer, kept for as long as the process lives, so leaving a
 * conversation and coming back finds it where it was. One per app (AppGraph): a conversation's view model
 * goes with its screen, this does not.
 *
 * Memory only, on purpose: a draft is message text this app otherwise keeps only in the core's encrypted
 * store, so it is never written to disk beside it.
 */
class Drafts {
    private val texts = ConcurrentHashMap<String, String>()

    operator fun get(conversation: String): String = texts[conversation].orEmpty()

    /** Keeps [text] for [conversation]; a blank one is no draft. */
    operator fun set(
        conversation: String,
        text: String,
    ) {
        if (text.isBlank()) texts.remove(conversation) else texts[conversation] = text
    }

    /** Forgets every draft: they are one account's, and the next one signed in must not see them (#337). */
    fun clear() = texts.clear()
}
