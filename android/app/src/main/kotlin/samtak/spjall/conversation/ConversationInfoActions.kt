package samtak.spjall.conversation

import samtak.spjall.core.Item
import samtak.spjall.core.MuteFor

/** What [ConversationInfoScreen] can ask for (0055): its settings, and the photos and files it lists. */
@Suppress("TooManyFunctions")
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

    /** Opens the picker to put more people in this group (0078). */
    fun add() = Unit

    /** Names the group, or clears its name with null (0078). */
    fun rename(name: String?) = Unit

    /** Opens the picker for the group's photo (0094); the choice goes to the group as a set or a replace. */
    fun setPhoto() = Unit

    /** Removes the group's photo, for everyone in it (0094). */
    fun clearPhoto() = Unit

    /** Removes [account] from the group, for everyone (0078). */
    fun remove(account: String) = Unit

    /** Leaves the group (0078); this account stops receiving it. */
    fun leave() = Unit

    /** Downloads the photo of [item] to show it in the grid. */
    fun fetch(item: Item)

    /** Opens the photo or file of [item] in another app, as the conversation does. */
    fun open(item: Item)

    /** The next page of photos and files. */
    fun more()

    fun retry()
}
