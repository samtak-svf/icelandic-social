package samtak.spjall.social

import samtak.spjall.core.ReactionKind
import samtak.spjall.core.ReportReason

/** What [CommunitiesScreen] can ask for. */
interface CommunitiesActions {
    fun open(communityId: String)

    fun openPost(postId: String)

    fun react(
        postId: String,
        kind: ReactionKind,
    )

    fun report(
        postId: String,
        reason: ReportReason,
        note: String,
    )

    fun selectTab(tab: CommunitiesTab)

    /** "Stofna samfélag": only offered to a verified account (decision 0063). */
    fun create()

    fun search(text: String)

    /** The end of the search came into view. */
    fun more()

    fun moreFeed()

    fun retry()
}
