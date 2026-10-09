package samtak.spjall.feed

import samtak.spjall.core.Person

/** What [RepliesScreen] can ask for. */
interface RepliesActions {
    fun back()

    fun author(person: Person)

    fun heart()

    fun deletePost()

    fun send(body: String)

    fun delete(replyId: String)

    fun loadMore()

    fun retry()
}
