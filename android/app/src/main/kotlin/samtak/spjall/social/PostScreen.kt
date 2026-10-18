package samtak.spjall.social

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.Comment
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
    val post = state.post
    Surface(modifier = Modifier.fillMaxSize(), color = Palette.bg, contentColor = Palette.fg) {
        Column(modifier = Modifier.windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal))) {
            SubHeader(stringResource(R.string.post_back)) { post?.let { actions.community(it.communityId) } }
            if (state.busy) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            LazyColumn(
                modifier = Modifier.weight(1f).imePadding(),
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
                        )
                    }
                }
                if (state.loaded && post != null && state.comments.isEmpty()) {
                    item(key = "empty") { Muted(stringResource(R.string.comments_empty)) }
                }
                itemsIndexed(state.comments, key = { _, item -> item.commentId }) { index, comment ->
                    CommentCard(comment, comment.commentId in state.reported) {
                        reporting = "$COMMENT:${comment.commentId}"
                    }
                    if (index == state.comments.lastIndex && state.next != null) {
                        LaunchedEffect(state.next) { actions.more() }
                    }
                }
                if (post != null) {
                    item(key = "composer") {
                        Composer(
                            label = stringResource(R.string.comment_compose),
                            action = stringResource(R.string.comment_publish),
                            text = state.draft,
                            sending = state.sending,
                            onText = actions::draft,
                            onSend = actions::send,
                        )
                    }
                }
            }
        }
    }
    target?.let {
        ReportDialog(
            onSend = { reason, note -> actions.report(it, reason, note) },
            onDismiss = { reporting = null },
        )
    }
}

@Composable
private fun CommentCard(
    comment: Comment,
    reported: Boolean,
    onReport: () -> Unit,
) {
    SocialCard {
        StateMark(comment.state)
        Byline(comment.author, comment.createdAt)
        Text(text = comment.body, style = MaterialTheme.typography.bodyLarge)
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            ReportControl(reported, onReport)
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
