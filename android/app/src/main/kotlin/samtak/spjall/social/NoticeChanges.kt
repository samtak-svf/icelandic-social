package samtak.spjall.social

import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow

/**
 * Tells the bell to ask for its count again (#570). A call that ends one of the account's own notices, such as
 * answering an invitation or a friend request, leaves the count one too high until the next screen asks, so the
 * wrapper below announces each such call once it has succeeded and no screen has to remember to.
 */
class NoticeChanges {
    private val _changed =
        MutableSharedFlow<Unit>(extraBufferCapacity = 1, onBufferOverflow = BufferOverflow.DROP_OLDEST)

    val changed: Flow<Unit> = _changed

    fun announce() {
        _changed.tryEmit(Unit)
    }
}

/** [Social] that announces on [changes] after each call that ends a notice of the caller's succeeds. */
class NoticingSocial(
    private val inner: Social,
    private val changes: NoticeChanges,
) : Social by inner {
    override fun joinCommunity(id: String) = inner.joinCommunity(id).also { changes.announce() }

    override fun withdrawJoinRequest(id: String) = inner.withdrawJoinRequest(id).also { changes.announce() }

    override fun acceptFriendRequest(accountId: String) =
        inner.acceptFriendRequest(accountId).also { changes.announce() }

    override fun declineFriendRequest(accountId: String) =
        inner.declineFriendRequest(accountId).also { changes.announce() }
}
