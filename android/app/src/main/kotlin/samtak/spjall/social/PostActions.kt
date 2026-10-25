package samtak.spjall.social

import samtak.spjall.core.Comment
import samtak.spjall.core.ReactionKind
import samtak.spjall.core.ReportReason
import samtak.spjall.core.ReportTarget

/** What [PostScreen] can ask for. */
@Suppress("TooManyFunctions")
interface PostActions {
    /** "Til baka í samfélagið". */
    fun community(communityId: String)

    fun draft(text: String)

    fun send()

    /** Opens the picker for the comment's one image. */
    fun addImage()

    /** Takes the comment's picked image out. */
    fun removeImage()

    fun onReplyTo(comment: Comment?)

    fun react(kind: ReactionKind)

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

    /** Deletes this account's own comment, once it confirmed. */
    fun deleteComment(commentId: String)

    fun report(
        target: ReportTarget,
        reason: ReportReason,
        note: String,
    )

    fun more()

    fun retry()
}
