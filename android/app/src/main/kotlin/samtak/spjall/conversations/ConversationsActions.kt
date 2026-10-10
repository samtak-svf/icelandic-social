package samtak.spjall.conversations

/** What [ConversationsScreen] can ask for. */
interface ConversationsActions {
    fun open(conversation: String)

    fun newConversation()

    /** To the invite link and QR code in "Ég". */
    fun invite()

    fun retry()

    /** The system's notification settings for the app. */
    fun notificationSettings()
}
