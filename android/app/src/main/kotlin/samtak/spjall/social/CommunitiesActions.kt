package samtak.spjall.social

import samtak.spjall.core.ReportReason

/** What [CommunitiesScreen] can ask for. */
@Suppress("TooManyFunctions")
interface CommunitiesActions : PollActions {
    fun open(communityId: String)

    fun openPost(postId: String)

    /** Opens the post with its comment field focused. */
    fun comment(postId: String)

    /** Opens the picker that sends the post into conversations. */
    fun sendToConversation(postId: String)

    fun react(
        postId: String,
        emoji: String,
    )

    fun report(
        postId: String,
        reason: ReportReason,
        note: String,
    )

    fun selectTab(tab: CommunitiesTab)

    /** Pins or unpins a community in this account's hub (0080). */
    fun pin(
        communityId: String,
        pinned: Boolean,
    )

    /** `community_create`: only offered to a verified account (decision 0063). */
    fun create()

    fun search(text: String)

    /** The end of the search came into view. */
    fun more()

    fun moreFeed()

    fun retry()
}
