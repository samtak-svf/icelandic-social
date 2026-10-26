package samtak.spjall.social

import samtak.spjall.core.CommunityAudience
import samtak.spjall.core.CommunityRole
import samtak.spjall.core.ReportReason
import samtak.spjall.core.ReportTarget

/** What [CommunityScreen] can ask for. */
@Suppress("TooManyFunctions")
interface CommunityActions : PollActions {
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

    /** The anonymous posts that wait for approval (0091), for the owner and moderators. */
    fun anonymousQueue()

    /** Shows a tab of the community (0089). */
    fun selectTab(tab: CommunityTab)

    /** The end of Myndir came into view: the next page of pictures. */
    fun moreGallery()

    /** Turns the post being written into a poll (0090), or back. */
    fun togglePoll()

    fun pollOption(
        index: Int,
        text: String,
    )

    fun addPollOption()

    fun removePollOption(index: Int)

    /** Whether the post being written goes without the author's name (0091). */
    fun setAnonymous(on: Boolean)

    /** The owner allows or stops anonymous posts in the community (0091). */
    fun setAnonymousPosts(on: Boolean)

    /** Asks for the author of an anonymous post; the community's log records who asked. */
    fun revealAuthor(postId: String)

    fun onSearchQuery(query: String)

    fun searchPosts()

    fun loadMembers()

    fun setCommunityRole(
        accountId: String,
        role: CommunityRole,
    )

    fun updateCommunity(
        name: String,
        description: String,
        audience: CommunityAudience?,
    )

    fun loadModerationLog()

    /** Opens the picker for the community picture, or the cover (0080). */
    fun pickPicture()

    fun pickCover()

    /** Opens the crop sheet on the picture, or the cover, already set (decision 0086). */
    fun reframePicture()

    fun reframeCover()

    fun removePicture()

    fun removeCover()

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

    /** Opens the post with its comment field focused. */
    fun comment(postId: String)

    /** Pins the post to the top of the community, or loosens it. */
    fun pin(
        postId: String,
        pinned: Boolean,
    )

    /** Opens the picker that sends the post into conversations. */
    fun sendToConversation(postId: String)

    fun react(
        postId: String,
        emoji: String,
    )

    fun report(
        target: ReportTarget,
        reason: ReportReason,
        note: String,
    )

    fun more()

    fun retry()
}

/**
 * What the feed asks of the screen around it: open Stjórna, report or delete a post, open Um samfélagið, and open
 * the composer. The screen holds what these change above its layouts, so a change of size class (which moves the
 * feed into another pane) keeps it (decision 0087).
 */
internal class FeedCallbacks(
    val onManage: () -> Unit,
    val onReport: (String) -> Unit,
    val onDelete: (String) -> Unit,
    val onInfo: () -> Unit,
    val onCompose: () -> Unit,
)
