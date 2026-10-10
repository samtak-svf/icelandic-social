package samtak.spjall.conversations

/** What [PickScreen] can ask for. */
interface PickActions {
    fun toggle(conversation: String)

    /** Into every picked conversation. */
    fun send()

    fun back()

    fun retry()
}
