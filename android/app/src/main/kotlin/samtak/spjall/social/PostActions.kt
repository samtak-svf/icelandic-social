package samtak.spjall.social

import samtak.spjall.core.Comment
import samtak.spjall.core.ReactionKind
import samtak.spjall.core.ReportReason
import samtak.spjall.core.ReportTarget

/** What [PostScreen] can ask for. */
interface PostActions {
    /** "Til baka í samfélagið". */
    fun community(communityId: String)

    fun draft(text: String)

    fun send()

    fun onReplyTo(comment: Comment?)

    fun react(kind: ReactionKind)

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
