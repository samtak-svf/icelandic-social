package samtak.spjall.social

import samtak.spjall.core.ReactionKind
import samtak.spjall.core.ReportReason
import samtak.spjall.core.ReportTarget

/** What [PostScreen] can ask for. */
interface PostActions {
    /** "Til baka í samfélagið". */
    fun community(communityId: String)

    fun draft(text: String)

    fun send()

    fun react(kind: ReactionKind)

    fun report(
        target: ReportTarget,
        reason: ReportReason,
        note: String,
    )

    fun more()

    fun retry()
}
