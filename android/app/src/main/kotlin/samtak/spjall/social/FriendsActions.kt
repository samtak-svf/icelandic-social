package samtak.spjall.social

import samtak.spjall.core.FriendSort
import samtak.spjall.core.ReportReason
import samtak.spjall.core.ReportTarget
import samtak.spjall.core.WallAudience

/** What the friends screen asks of its view model, so a screen test can stand in for it (decision 0114). */
interface FriendsActions {
    fun back()

    fun retry()

    fun query(text: String)

    fun sort(sort: FriendSort)

    fun open(accountId: String)

    fun accept(accountId: String)

    fun decline(accountId: String)

    fun cancel(accountId: String)

    fun unsnooze(accountId: String)
}

/** What the person screen asks of its view model. */
@Suppress("TooManyFunctions")
interface PersonActions :
    PollActions,
    Attaching {
    fun back()

    fun retry()

    fun open(accountId: String)

    fun openCommunity(communityId: String)

    fun add()

    fun cancel()

    fun accept()

    fun decline()

    fun end()

    fun snooze()

    fun unsnooze()

    /** The settings behind the gear on this account's own wall (0115). */
    fun settings() {}

    fun openPost(postId: String) {}

    fun selectTab(tab: WallTab) {}

    fun morePosts() {}

    fun moreImages() {}

    fun draft(text: String) {}

    fun audience(audience: WallAudience) {}

    fun publish() {}

    fun postAudience(
        postId: String,
        audience: WallAudience,
    ) {}

    fun deletePost(postId: String) {}

    fun react(
        postId: String,
        emoji: String,
    ) {}

    fun saveBio(text: String) {}

    fun chooseCover() {}

    fun reframeCover() {}

    fun removeCover() {}

    /** Reports the account, or one of its wall posts. */
    fun report(
        target: ReportTarget,
        reason: ReportReason,
        note: String,
    ) {}

    fun block() {}

    /** The account was blocked: the web goes to the friends list, whichever way it came (0114). */
    fun blocked() {}

    override fun addImage() {}

    override fun removeImage(path: String) {}

    override fun togglePoll() {}

    override fun pollOption(
        index: Int,
        text: String,
    ) {}

    override fun addPollOption() {}

    override fun removePollOption(index: Int) {}

    override fun vote(
        postId: String,
        optionId: String,
    ) {}

    override fun withdrawVote(postId: String) {}

    override fun closePoll(postId: String) {}
}
