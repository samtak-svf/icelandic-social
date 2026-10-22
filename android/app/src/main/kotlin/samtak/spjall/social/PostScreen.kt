package samtak.spjall.social

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.Author
import samtak.spjall.core.Comment
import samtak.spjall.core.ModerationState
import samtak.spjall.core.ReportTarget
import samtak.spjall.core.ReportTargetKind
import samtak.spjall.ui.Palette
import samtak.spjall.ui.ProblemCard

/** One post, its comments oldest first, and the box to add one. */
@Composable
fun PostScreen(
    state: PostViewModel.State,
    actions: PostActions,
) {
    // What is being reported, as "post:<id>" or "comment:<id>", so it survives a rotation.
    var reporting by rememberSaveable { mutableStateOf<String?>(null) }
    val target = reporting?.let(::target)
    if (target != null && target.id in state.reported) reporting = null
    // This account's own post or comment it asked to delete, as reporting keys it, until it confirms or cancels.
    var deleting by rememberSaveable { mutableStateOf<String?>(null) }
    val delete: (String, Author) -> (() -> Unit)? = { key, author ->
        { deleting = key }.takeIf {
            author.accountId ==
                state.me
        }
    }
    val post = state.post
    Surface(modifier = Modifier.fillMaxSize(), color = Palette.bg, contentColor = Palette.fg) {
        Column(modifier = Modifier.windowInsetsPadding(WindowInsets.safeDrawing.only(SUB_SCREEN_SIDES))) {
            SubHeader(stringResource(R.string.post_title), onBack = {
                post?.let { actions.community(it.communityId) }
            })
            if (state.busy) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            LazyColumn(
                modifier = Modifier.weight(1f),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                state.problem?.let { problem -> item(key = "problem") { ProblemCard(problem) { actions.retry() } } }
                if (post != null) {
                    item(key = "post") {
                        PostCard(
                            post = post,
                            reacting = state.reacting,
                            reported = post.postId in state.reported,
                            onReact = actions::react,
                            onReport = { reporting = "$POST:${post.postId}" },
                            onOpen = null,
                            onDelete = delete("$POST:${post.postId}", post.author),
                        )
                    }
                }
                if (state.loaded && post != null && state.comments.isEmpty()) {
                    item(key = "empty") { Muted(stringResource(R.string.comments_empty)) }
                }
                commentItems(state, actions, delete, onReport = { reporting = it })
            }
            // The box to write in stays at the foot of the screen, reachable without scrolling past every comment.
            if (post != null) ReplyBox(state, actions)
        }
    }
    Dialogs(target, deleting?.let(::target), actions, onReported = { reporting = null }) { deleting = null }
}

/** The top-level comments oldest first, each with its replies indented under it; asks for the next page at the end. */
private fun LazyListScope.commentItems(
    state: PostViewModel.State,
    actions: PostActions,
    delete: (String, Author) -> (() -> Unit)?,
    onReport: (String) -> Unit,
) {
    val topLevel = state.comments.filter { it.parentCommentId == null }
    itemsIndexed(topLevel, key = { _, item -> item.commentId }) { index, comment ->
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            CommentCard(
                comment = comment,
                reported = comment.commentId in state.reported,
                onReport = { onReport("$COMMENT:${comment.commentId}") },
                onDelete = delete("$COMMENT:${comment.commentId}", comment.author),
            )
            if (state.writes &&
                !(comment.state == ModerationState.REMOVED && comment.body.isEmpty())
            ) {
                TextButton(onClick = { actions.onReplyTo(comment) }) {
                    Text(stringResource(R.string.comment_reply))
                }
            }
            state.comments.filter { it.parentCommentId == comment.commentId }.forEach { reply ->
                CommentCard(
                    comment = reply,
                    reported = reply.commentId in state.reported,
                    onReport = { onReport("$COMMENT:${reply.commentId}") },
                    onDelete = delete("$COMMENT:${reply.commentId}", reply.author),
                    modifier = Modifier.padding(start = 24.dp),
                )
            }
        }
        if (index == topLevel.lastIndex && state.next != null) {
            LaunchedEffect(state.next) { actions.more() }
        }
    }
}

/** The box to write a comment in, at the foot of the screen, with the comment it replies to if one is picked. */
@Composable
private fun ReplyBox(
    state: PostViewModel.State,
    actions: PostActions,
) {
    Column(modifier = Modifier.imePadding()) {
        HorizontalDivider(color = Palette.border)
        Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
            state.replyingTo?.let { comment ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        stringResource(R.string.comment_replying_to, comment.author.shownName()),
                        modifier = Modifier.weight(1f),
                        color = Palette.mutedFg,
                    )
                    IconButton(onClick = { actions.onReplyTo(null) }) {
                        Icon(Icons.Filled.Close, contentDescription = stringResource(R.string.cancel))
                    }
                }
            }
            CommentComposer(state, actions)
        }
    }
}

/** The box to add a comment in. */
@Composable
private fun CommentComposer(
    state: PostViewModel.State,
    actions: PostActions,
) {
    Composer(
        label = stringResource(R.string.comment_compose),
        action = stringResource(R.string.comment_publish),
        text = state.draft,
        sending = state.sending,
        onText = actions::draft,
        onSend = actions::send,
    )
}

/** The report being written, or the delete being asked about, for the post or one of its comments. */
@Composable
private fun Dialogs(
    reporting: ReportTarget?,
    deleting: ReportTarget?,
    actions: PostActions,
    onReported: () -> Unit,
    onDeleted: () -> Unit,
) {
    reporting?.let {
        ReportDialog(onSend = { reason, note -> actions.report(it, reason, note) }, onDismiss = onReported)
    }
    deleting?.let { doomed ->
        val post = doomed.kind == ReportTargetKind.POST
        ConfirmDelete(
            if (post) R.string.post_delete_confirm else R.string.comment_delete_confirm,
            onDelete = { if (post) actions.deletePost() else actions.deleteComment(doomed.id) },
            onDismiss = onDeleted,
        )
    }
}

@Composable
private fun CommentCard(
    comment: Comment,
    reported: Boolean,
    onReport: () -> Unit,
    onDelete: (() -> Unit)?,
    modifier: Modifier = Modifier,
) {
    if (comment.state == ModerationState.REMOVED && comment.body.isEmpty()) {
        SocialCard(modifier) {
            Text(
                stringResource(R.string.comment_tombstone),
                style = MaterialTheme.typography.bodyMedium.copy(fontStyle = FontStyle.Italic),
                color = Palette.mutedFg,
            )
        }
    } else {
        SocialCard(modifier) {
            StateMark(comment.state)
            Byline(comment.author, comment.createdAt) {
                CardActions(reported = reported, onReport = onReport, onDelete = onDelete)
            }
            Text(text = comment.body, style = MaterialTheme.typography.bodyLarge)
        }
    }
}

private fun target(key: String): ReportTarget? {
    val (kind, id) = key.split(":", limit = 2).takeIf { it.size == 2 } ?: return null
    return when (kind) {
        POST -> ReportTarget(ReportTargetKind.POST, id)
        COMMENT -> ReportTarget(ReportTargetKind.COMMENT, id)
        else -> null
    }
}

private const val POST = "post"
private const val COMMENT = "comment"
