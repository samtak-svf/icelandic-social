package samtak.spjall.conversation

import samtak.spjall.core.Item

/**
 * What [ConversationScreen] can ask for: one function per thing a bubble or
 * the composer offers, so it is long.
 */
@Suppress("TooManyFunctions")
interface ConversationActions {
    fun back()

    fun draft(text: String)

    fun send()

    fun reply(item: Item)

    /** Opens the picker that copies [item] into other conversations (decision 0041). */
    fun forward(item: Item)

    fun edit(item: Item)

    fun cancelMode()

    fun delete(item: Item)

    fun react(
        item: Item,
        emoji: String,
    )

    /** Sends the failed items again. */
    fun resend()

    fun loadOlder()

    /** Opens the photo picker; what is picked is sent. */
    fun attachPhoto()

    /** Opens the file picker; what is picked is sent. */
    fun attachFile()

    /** Downloads the photo or file of [item]. */
    fun fetch(item: Item)

    /** Opens the photo or file of [item] in another app. */
    fun open(item: Item)

    /** Fetches a shared post for its card, which is on screen (decision 0040). */
    fun showPost(postId: String)

    /** Opens a shared post's replies. */
    fun openPost(postId: String)

    /** Sets the disappearing timer, or turns it off with null. */
    fun timer(seconds: UInt?)

    /** Blocks the other person of a 1:1. */
    fun block()

    fun retry()

    /** The screen left or went to the background. */
    fun paused()
}
