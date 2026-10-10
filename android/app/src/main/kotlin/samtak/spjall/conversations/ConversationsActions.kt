package samtak.spjall.conversations

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

    /** The system's notification settings for the app. */
    fun notificationSettings()
}
