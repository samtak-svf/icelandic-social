package samtak.spjall.conversation

import samtak.spjall.core.Item
import samtak.spjall.core.MuteFor

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

    /** Opens the photo picker; what is picked waits above the field (0048). */
    fun attachPhoto()

    /** Opens the system camera (0047); the photo it takes waits above the field (0048). */
    fun takePhoto()

    /** Opens the file picker; what is picked waits above the field (0048). */
    fun attachFile()

    /** Asks for location if the app has none, then looks for the phone's place (0059). */
    fun attachLocation()

    /** Sends the place found and shown. */
    fun sendLocation()

    /** Stops looking for the place, or drops the one found. */
    fun cancelLocation()

    /** Opens a location's map.is link or `geo:` URI (0059). */
    fun openPlace(uri: String)

    /** Takes the waiting photo or file away. */
    fun removeAttachment()

    /** Downloads the photo or file of [item]. */
    fun fetch(item: Item)

    /** Opens the photo or file of [item] in another app. */
    fun open(item: Item)

    /** Sets the disappearing timer, or turns it off with null. */
    fun timer(seconds: UInt?)

    /** Mutes the conversation for [duration] (0042). */
    fun mute(duration: MuteFor)

    /** Turns the conversation's notifications back on. */
    fun unmute()

    /** Blocks the other person of a 1:1. */
    fun block()

    /** Opens the conversation's information screen (0055). */
    fun info()

    fun retry()

    /** The screen left or went to the background. */
    fun paused()
}
