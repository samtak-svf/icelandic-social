package samtak.spjall.social

import samtak.spjall.core.ReactionKind
import samtak.spjall.core.ReportReason
import samtak.spjall.core.ReportTarget

/** What [CommunityScreen] can ask for. */
interface CommunityActions {
    fun back()

    fun join()

    fun leave()

    /** Into the post and its comments. */
    fun open(postId: String)

    /** The report queue, for the owner and moderators. */
    fun reports()

    fun draft(text: String)

    fun publish()

    fun react(
        postId: String,
        kind: ReactionKind,
    )

    fun report(
        target: ReportTarget,
        reason: ReportReason,
        note: String,
    )

    fun more()

    fun retry()
}
