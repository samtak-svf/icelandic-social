package samtak.spjall.conversations

/** What [PickScreen] can ask for. */
interface PickActions {
    fun toggle(conversation: String)

    /** Into every picked conversation. */
    fun send()

    /** The search by name changed (decisions 0038, 0043). */
    fun search(text: String)

    fun back()

    fun retry()
}
