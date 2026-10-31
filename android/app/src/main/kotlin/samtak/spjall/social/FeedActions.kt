package samtak.spjall.social

import samtak.spjall.core.PostTarget
import samtak.spjall.core.ReportReason
import samtak.spjall.core.WallAudience

/** What the feed tab can do (decision 0116): the cards' actions, paging, refresh and the composer. */
@Suppress("TooManyFunctions")
interface FeedActions :
    PollActions,
    Attaching {
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

    fun deletePost(postId: String)

    /** The end of the list is in view, or nothing is held while a cursor remains. */
    fun more()

    fun refresh()

    fun retry()

    fun openComposer()

    /** The sheet was dismissed: the draft stays for the next time it opens. */
    fun closeComposer()

    fun draft(text: String)

    fun target(target: PostTarget)

    fun audience(audience: WallAudience)

    fun anonymous(anonymous: Boolean)

    fun publish()
}
