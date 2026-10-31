package samtak.spjall.social

import samtak.spjall.core.Comment
import samtak.spjall.core.CommentPage
import samtak.spjall.core.CoreClient

/** The comment calls of [Social], apart so each file stays under the cap. */
interface SocialComments {
    /** Likes a comment as this account. */
    fun likeComment(commentId: String)

    /** Takes this account's like off a comment. */
    fun unlikeComment(commentId: String)

    /** A page of a post's comments, oldest first; [after] is the `next` of the page before. */
    fun comments(
        postId: String,
        after: String?,
        limit: UInt,
    ): CommentPage

    /** A comment of text, one image by its media id from `uploadPostImage`, or both (0082). */
    fun createComment(
        postId: String,
        body: String,
        parentCommentId: String? = null,
        media: List<String> = emptyList(),
    ): Comment

    /** Deletes this account's own comment. */
    fun deleteComment(commentId: String)
}

/** [SocialComments] over the core's client. */
class CoreComments(
    lazyClient: Lazy<CoreClient>,
) : SocialComments {
    private val client by lazyClient

    override fun likeComment(commentId: String) = client.likeComment(commentId)

    override fun unlikeComment(commentId: String) = client.unlikeComment(commentId)

    override fun comments(
        postId: String,
        after: String?,
        limit: UInt,
    ) = client.comments(postId, after, limit)

    override fun createComment(
        postId: String,
        body: String,
        parentCommentId: String?,
        media: List<String>,
    ) = client.createComment(postId, body, parentCommentId, media)

    override fun deleteComment(commentId: String) = client.deleteComment(commentId)
}
