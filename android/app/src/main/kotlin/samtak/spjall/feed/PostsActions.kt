package samtak.spjall.feed

import samtak.spjall.core.Person
import samtak.spjall.core.Post

/** What a list of posts can ask for: Fljótið, Ég's wall and another account's. */
interface PostsActions {
    /** Opens the author's wall, or Ég for this account's own posts. */
    fun author(person: Person)

    fun heart(post: Post)

    fun replies(postId: String)

    fun delete(postId: String)

    /** Opens the conversation picker to send the post into conversations (decision 0040). */
    fun share(postId: String)

    fun post(body: String)

    fun loadMore()

    fun refresh()
}
