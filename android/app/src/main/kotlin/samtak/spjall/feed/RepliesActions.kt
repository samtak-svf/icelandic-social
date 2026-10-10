package samtak.spjall.feed

import samtak.spjall.core.Person

/** What [RepliesScreen] can ask for. */
interface RepliesActions {
    fun back()

    fun author(person: Person)

    fun heart()

    fun deletePost()

    /** Opens the conversation picker to send the post into conversations (decision 0040). */
    fun share()

    fun send(body: String)

    fun delete(replyId: String)

    fun loadMore()

    fun retry()
}
