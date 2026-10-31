package samtak.spjall.social

import androidx.navigation.NavController
import samtak.spjall.core.ReportReason
import samtak.spjall.core.ReportTarget

/** The post screen's actions, wired to its model and the navigation (split out of `SocialNav.kt`). */
internal fun postActions(
    model: PostViewModel,
    nav: NavController,
    sharePost: (String) -> Unit,
    add: () -> Unit,
): PostActions =
    object : PostActions {
        override fun community(communityId: String) = nav.leavePostForCommunity(communityId)

        override fun vote(optionId: String) = model.vote(optionId)

        override fun withdrawVote() = model.withdrawVote()

        override fun closePoll() = model.closePoll()

        override fun deletePost() = model.deletePost()

        override fun deleteComment(
            commentId: String,
            reason: String?,
        ) = model.deleteComment(commentId, reason)

        override fun draft(text: String) = model.draft(text)

        override fun send() = model.send()

        override fun addImage() = add()

        override fun removeImage() = model.unpick()

        override fun onReplyTo(comment: samtak.spjall.core.Comment?) = model.onReplyTo(comment)

        override fun react(emoji: String) = model.react(emoji)

        override fun likeComment(commentId: String) = model.likeComment(commentId)

        override fun pin(pinned: Boolean) = model.pin(pinned)

        override fun sendToConversation(postId: String) = sharePost(postId)

        override fun report(
            target: ReportTarget,
            reason: ReportReason,
            note: String,
        ) = model.report(target, reason, note)

        override fun more() = model.more()

        override fun retry() = model.retry()
    }
