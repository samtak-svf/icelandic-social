package samtak.spjall.conversation

import samtak.spjall.core.Item
import samtak.spjall.core.MuteFor

/** What [ConversationInfoScreen] can ask for (0055): its settings, and the photos and files it lists. */
interface ConversationInfoActions {
    fun back()

    /** Sets the disappearing timer, or turns it off with null. */
    fun timer(seconds: UInt?)

    /** Mutes the conversation for [duration] (0042). */
    fun mute(duration: MuteFor)

    /** Turns the conversation's notifications back on. */
    fun unmute()

    /** Blocks the other person of a 1:1. */
    fun block()

    /** Downloads the photo of [item] to show it in the grid. */
    fun fetch(item: Item)

    /** Opens the photo or file of [item] in another app, as the conversation does. */
    fun open(item: Item)

    /** The next page of photos and files. */
    fun more()

    fun retry()
}
