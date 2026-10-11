package samtak.spjall.conversations

import samtak.spjall.core.MuteFor

/** What [ConversationsScreen] can ask for. */
interface ConversationsActions {
    fun open(conversation: String)

    fun newConversation()

    /** The search under the header, as typed. */
    fun search(text: String)

    /** Into the 1:1 with someone the search found in the directory, made when there is none. */
    fun openPerson(account: String)

    /** To the invite link and QR code in "Ég". */
    fun invite()

    fun retry()

    /** From a long press on a row (0043): the mute of 0042, as the conversation's own menu offers it. */
    fun mute(
        conversation: String,
        duration: MuteFor,
    )

    fun unmute(conversation: String)

    /** The system's notification settings for the app. */
    fun notificationSettings()
}
