package samtak.spjall.social

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import samtak.spjall.account.Problem
import samtak.spjall.account.problem
import samtak.spjall.core.CoreException
import samtak.spjall.core.Post

/** The poll calls of a screen that lists posts, each named by its post. */
interface PollActions {
    fun vote(
        postId: String,
        optionId: String,
    )

    fun withdrawVote(postId: String)

    fun closePoll(postId: String)
}

/** The poll card's callbacks for [postId]; closing is offered only when [mayClose]. */
internal fun PollActions.callbacksFor(
    postId: String,
    mayClose: Boolean,
) = PollCallbacks(
    onVote = { vote(postId, it) },
    onWithdraw = { withdrawVote(postId) },
    onClose = { closePoll(postId) }.takeIf { mayClose },
)

/**
 * Runs one poll call (vote, withdraw or close) for a view model: nothing while the post's previous call is
 * still on its way ([busy]), otherwise [begin], then [call] off the main thread, then [finish] with the post as
 * the server now has it, or with the problem. The one copy of this, shared by every screen that shows a poll.
 */
internal fun CoroutineScope.answerPoll(
    io: CoroutineDispatcher,
    busy: Boolean,
    begin: () -> Unit,
    call: () -> Post,
    finish: (changed: Post?, problem: Problem?) -> Unit,
) {
    if (busy) return
    begin()
    launch {
        try {
            finish(withContext(io) { call() }, null)
        } catch (e: CoreException) {
            finish(null, e.problem())
        }
    }
}
