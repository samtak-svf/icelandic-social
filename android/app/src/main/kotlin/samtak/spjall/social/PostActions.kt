package samtak.spjall.social

import samtak.spjall.core.Comment
import samtak.spjall.core.ReportReason
import samtak.spjall.core.ReportTarget

/** What [PostScreen] can ask for. */
@Suppress("TooManyFunctions")
interface PostActions {
    /** `post_back`. */
    fun community(communityId: String)

    fun draft(text: String)

    fun send()

    /** Opens the picker for the comment's one image. */
    fun addImage()

    /** Takes the comment's picked image out. */
    fun removeImage()

    fun onReplyTo(comment: Comment?)

    fun react(emoji: String)

    /** Likes the comment, or takes the like back. */
    fun likeComment(commentId: String)

    /** Votes for an option of the post's poll, or changes the vote to it. */
    fun vote(optionId: String)

    fun withdrawVote()

    fun closePoll()

    /** Pins the post to the top of its community, or loosens it. */
    fun pin(pinned: Boolean)

    /** Opens the picker that sends the post into conversations. */
    fun sendToConversation(postId: String)

    /** Deletes this account's own post, once it confirmed. */
    fun deletePost()

    /** Deletes this account's own comment, once it confirmed; with a reason, removes another's from its own wall. */
    fun deleteComment(
        commentId: String,
        reason: String? = null,
    )

    fun report(
        target: ReportTarget,
        reason: ReportReason,
        note: String,
    )

    fun more()

    fun retry()
}
