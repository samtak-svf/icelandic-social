package samtak.spjall.social

import samtak.spjall.core.ReactionKind
import samtak.spjall.core.ReportReason
import samtak.spjall.core.ReportTarget

/** What [CommunityScreen] can ask for. */
@Suppress("TooManyFunctions")
interface CommunityActions {
    fun back()

    fun join()

    fun leave()

    /** Takes back the request to join that waits. */
    fun withdraw()

    /** Into the post and its comments. */
    fun open(postId: String)

    /** The report queue, for the owner and moderators. */
    fun reports()

    /** The join requests that wait, for the owner and moderators. */
    fun requests()

    /** Deletes the community, once its owner confirmed. */
    fun deleteCommunity()

    fun draft(text: String)

    fun publish()

    /** Opens the picker for an image to go with the post, when another fits. */
    fun addImage()

    /** Takes a picked image out of the post. */
    fun removeImage(path: String)

    /** Deletes this account's own post, once it confirmed. */
    fun delete(postId: String)

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
