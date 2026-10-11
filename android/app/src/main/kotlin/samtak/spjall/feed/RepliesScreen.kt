package samtak.spjall.feed

import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.flow.Flow
import samtak.spjall.brand.R
import samtak.spjall.core.Reply
import samtak.spjall.me.Confirm
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.Avatar
import samtak.spjall.ui.EmptyState
import samtak.spjall.ui.Palette
import samtak.spjall.ui.ProblemCard
import samtak.spjall.ui.RoundButton
import samtak.spjall.ui.Type
import samtak.spjall.ui.capitals

/**
 * A post and its replies, oldest first, with a field at the bottom to add
 * one (decision 0034). A long press on an own reply deletes it, after asking.
 * A post that is gone says nothing more and takes the screen back.
 */
@Composable
fun RepliesScreen(
    state: RepliesViewModel.State,
    actions: RepliesActions,
    sent: Flow<Unit>,
) {
    var deleting by rememberSaveable { mutableStateOf<String?>(null) }
    LaunchedEffect(state.gone) { if (state.gone) actions.back() }
    Surface(modifier = Modifier.fillMaxSize(), color = Palette.surface) {
        Column(
            modifier =
                Modifier
                    .windowInsetsPadding(
                        WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal + WindowInsetsSides.Bottom),
                    ).imePadding(),
        ) {
            Header(actions::back)
            LazyColumn(modifier = Modifier.weight(1f)) {
                state.problem?.let {
                    item(key = "problem") {
                        Box(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                            ProblemCard(it, actions::retry)
                        }
                    }
                }
                state.post?.let { post ->
                    item(key = "post") {
                        PostRow(
                            post,
                            mine = post.author.account == state.me,
                            actions = actions.forPost(),
                        )
                        HorizontalDivider(color = Palette.border)
                    }
                }
                if (state.loaded && state.post != null && state.replies.isEmpty()) {
                    item(key = "empty") { EmptyState(AppIcons.Bubble, stringResource(R.string.replies_empty)) }
                }
                items(state.replies, key = { it.replyId }) { reply ->
                    ReplyRow(reply, mine = reply.author.account == state.me, actions) { deleting = reply.replyId }
                    if (reply == state.replies.last() && state.next != null) {
                        LaunchedEffect(reply.replyId) { actions.loadMore() }
                    }
                }
            }
            if (state.post != null) Field(state.sending, sent, actions::send)
        }
    }
    deleting?.let { replyId ->
        Confirm(
            text = stringResource(R.string.reply_delete_confirm),
            confirm = stringResource(R.string.delete),
            onConfirm = {
                deleting = null
                actions.delete(replyId)
            },
            onDismiss = { deleting = null },
        )
    }
}

/** The post at the top acts on itself; it has no replies button, being on its replies already. */
private fun RepliesActions.forPost() =
    PostActions(::author, ::heart, replies = null, delete = ::deletePost, share = ::share)

@Composable
private fun Header(onBack: () -> Unit) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .background(Palette.bg)
                .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top))
                .padding(start = 4.dp, end = 20.dp, top = 2.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        IconButton(onClick = onBack) {
            Icon(AppIcons.Back, contentDescription = stringResource(R.string.back), tint = Palette.fg)
        }
        Text(
            text = stringResource(R.string.replies_title).capitals(),
            style = Type.accountName,
            color = Palette.fg,
            modifier = Modifier.semantics { heading() },
        )
    }
}

/** One reply, indented under the post: smaller initials, the byline, the text. */
@Composable
private fun ReplyRow(
    reply: Reply,
    mine: Boolean,
    actions: RepliesActions,
    onDelete: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .combinedClickable(
                    enabled = mine,
                    onLongClickLabel = stringResource(R.string.delete),
                    onLongClick = onDelete,
                ) {}
                .padding(start = 32.dp, end = 16.dp, top = 8.dp, bottom = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Avatar(reply.author, size = AVATAR.dp)
        Column(modifier = Modifier.weight(1f)) {
            Byline(reply.author, reply.createdAt, onAuthor = { actions.author(reply.author) })
            Text(text = reply.body, style = Type.bubble, color = Palette.fg)
        }
    }
}

/** The field for a reply and its send button; it empties once the reply is up. */
@Composable
private fun Field(
    sending: Boolean,
    sent: Flow<Unit>,
    onSend: (String) -> Unit,
) {
    var text by rememberSaveable { mutableStateOf("") }
    LaunchedEffect(sent) { sent.collect { text = "" } }
    Column(modifier = Modifier.fillMaxWidth()) {
        HorizontalDivider(color = Palette.border)
        Row(
            modifier = Modifier.fillMaxWidth().padding(start = 12.dp, end = 4.dp, top = 6.dp, bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedTextField(
                value = text,
                onValueChange = { if (it.length <= POST_LIMIT) text = it },
                placeholder = { Text(stringResource(R.string.reply_placeholder)) },
                textStyle = Type.bubble,
                maxLines = MAX_LINES,
                shape = RoundedCornerShape(FIELD_RADIUS.dp),
                modifier = Modifier.weight(1f),
                colors =
                    OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = Palette.fg,
                        unfocusedBorderColor = Palette.border,
                    ),
            )
            val ready = !sending && postable(text) != null
            RoundButton(
                icon = AppIcons.Send,
                description = stringResource(R.string.post_reply),
                onClick = { onSend(text) },
                enabled = ready,
                fill = if (ready) Palette.primary else Palette.muted,
                tint = if (ready) Palette.primaryFg else Palette.mutedFg,
                size = SEND.dp,
            )
        }
    }
}

private const val AVATAR = 30
private const val SEND = 36
private const val FIELD_RADIUS = 22
private const val MAX_LINES = 5
