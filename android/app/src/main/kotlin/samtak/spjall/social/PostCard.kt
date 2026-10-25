package samtak.spjall.social

import android.widget.Toast
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.Post
import samtak.spjall.core.ReactionKind
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.Palette

/** What a post card can do; a callback that is null is an action the card does not offer. */
class PostCardCallbacks(
    val onReact: (ReactionKind) -> Unit,
    val onReport: () -> Unit,
    /** Opens the post; null on the post's own screen. */
    val onOpen: (() -> Unit)?,
    /** Opens the post with the comment field focused. */
    val onComment: () -> Unit,
    val onDelete: (() -> Unit)? = null,
    /** Pins or unpins the post; offered to a moderator and the owner. */
    val onPin: ((Boolean) -> Unit)? = null,
    /** Sends the post into conversations; null where that is not on offer. */
    val onSendToConversation: (() -> Unit)? = null,
    /** Votes in the post's poll; null where the poll is only shown. */
    val poll: PollCallbacks? = null,
    /** The poll's vote, withdraw or close is on its way. */
    val answering: Boolean = false,
    /** Asks for the author of an anonymous post; offered to a moderator. */
    val onReveal: (() -> Unit)? = null,
    /** The author a moderator asked for; an empty name is an account without one. */
    val revealed: String? = null,
)

/**
 * A post as a community's feed and its own screen show it (0080): the author row, a pinned marker, the text
 * clamped to [BODY_LINES] lines in the feed, the images, the reaction summary, the three actions, and in the feed
 * the newest comment and a pill to write one. A tap on the card opens it when the card can be opened.
 */
@Composable
fun PostCard(
    post: Post,
    reacting: Boolean,
    reported: Boolean,
    callbacks: PostCardCallbacks,
) {
    var sharing by rememberSaveable(post.postId) { mutableStateOf(false) }
    val inFeed = callbacks.onOpen != null
    SocialCard(
        modifier =
            if (callbacks.onOpen != null) {
                Modifier.clickable(role = Role.Button, onClick = callbacks.onOpen)
            } else {
                Modifier
            },
    ) {
        StateMark(post.state)
        AuthorRow(post.author, post.anonymousBylineRes(), post.createdAt) {
            CardActions(
                reported = reported,
                onReport = callbacks.onReport,
                onDelete = callbacks.onDelete,
                pinned = post.pinned,
                onPin = callbacks.onPin,
            )
        }
        if (post.pinned) PinnedMarker()
        if (post.body.isNotBlank()) PostBody(post.postId, post.body, clamp = inFeed)
        post.poll?.let { PollCard(it, callbacks.answering, callbacks.poll) }
        PostImageGrid(post)
        callbacks.onReveal?.takeIf { post.anonymous }?.let { reveal ->
            RevealAuthor(callbacks.revealed, onReveal = reveal)
        }
        ReactionSummary(post, callbacks.onOpen)
        HorizontalDivider(color = Palette.border)
        PostActions(post, reacting, callbacks.onReact, callbacks.onComment) { sharing = true }
        if (inFeed) {
            post.latestComment?.let { CommentPreview(it) }
            WriteCommentPill(callbacks.onComment)
        }
    }
    if (sharing) SharePostSheet(post.postId, callbacks.onSendToConversation) { sharing = false }
}

/** The text of a post; in the feed only [BODY_LINES] lines of it, with a way to read the rest in place. */
@Composable
private fun PostBody(
    postId: String,
    body: String,
    clamp: Boolean,
) {
    var expanded by rememberSaveable(postId) { mutableStateOf(false) }
    var overflows by remember(postId) { mutableStateOf(false) }
    val clamped = clamp && !expanded
    Text(
        text = body,
        style = MaterialTheme.typography.bodyLarge,
        maxLines = if (clamped) BODY_LINES else Int.MAX_VALUE,
        overflow = if (clamped) TextOverflow.Ellipsis else TextOverflow.Clip,
        onTextLayout = { result: TextLayoutResult -> if (result.hasVisualOverflow) overflows = true },
    )
    if (clamped && overflows) {
        Text(
            text = stringResource(R.string.post_see_more),
            style = MaterialTheme.typography.labelLarge,
            color = Palette.mutedFg,
            modifier = Modifier.heightIn(min = TOUCH.dp).clickable(role = Role.Button) { expanded = true },
        )
    }
}

/**
 * The more menu on a post or a comment: pin or unpin a post for a moderator, delete this account's own, or
 * report it; once the report was sent it says so instead of offering another.
 */
@Composable
fun CardActions(
    reported: Boolean,
    onReport: () -> Unit,
    onDelete: (() -> Unit)?,
    pinned: Boolean = false,
    onPin: ((Boolean) -> Unit)? = null,
) {
    var open by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { open = true }) {
            Icon(AppIcons.More, contentDescription = stringResource(R.string.more_options))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            if (onPin != null) {
                MenuItem(stringResource(if (pinned) R.string.post_unpin else R.string.post_pin)) {
                    open = false
                    onPin(!pinned)
                }
            }
            when {
                onDelete != null ->
                    MenuItem(stringResource(R.string.delete), Palette.danger) {
                        open = false
                        onDelete()
                    }
                reported -> MenuItem(stringResource(R.string.report_sent), enabled = false) { open = false }
                else ->
                    MenuItem(stringResource(R.string.report)) {
                        open = false
                        onReport()
                    }
            }
        }
    }
}

@Composable
private fun MenuItem(
    text: String,
    color: androidx.compose.ui.graphics.Color = androidx.compose.ui.graphics.Color.Unspecified,
    enabled: Boolean = true,
    onClick: () -> Unit,
) = DropdownMenuItem(text = { Text(text, color = color) }, onClick = onClick, enabled = enabled)

/** "Deila": the sheet that sends the post into a conversation, or copies its address. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SharePostSheet(
    postId: String,
    onSendToConversation: (() -> Unit)?,
    onDismiss: () -> Unit,
) {
    val clipboard = LocalClipboardManager.current
    val context = LocalContext.current
    val copied = stringResource(R.string.post_link_copied)
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Palette.surface) {
        Column(modifier = Modifier.padding(bottom = 24.dp)) {
            if (onSendToConversation != null) {
                SheetRow(stringResource(R.string.post_share_to_conversation)) {
                    onDismiss()
                    onSendToConversation()
                }
            }
            SheetRow(stringResource(R.string.post_copy_link)) {
                clipboard.setText(AnnotatedString(SocialLinks.post(postId)))
                Toast.makeText(context, copied, Toast.LENGTH_SHORT).show()
                onDismiss()
            }
        }
    }
}

@Composable
private fun SheetRow(
    text: String,
    onClick: () -> Unit,
) {
    Text(
        text = text,
        style = MaterialTheme.typography.bodyLarge,
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = 56.dp)
                .clickable(role = Role.Button, onClick = onClick)
                .padding(horizontal = 24.dp, vertical = 16.dp),
    )
}

internal data class Reaction(
    val kind: ReactionKind,
    val emoji: String,
    val label: Int,
)

internal val REACTIONS =
    listOf(
        Reaction(ReactionKind.LIKE, "\uD83D\uDC4D", R.string.reaction_like),
        Reaction(ReactionKind.LOVE, "\u2764\uFE0F", R.string.reaction_love),
        Reaction(ReactionKind.LAUGH, "\uD83D\uDE02", R.string.reaction_laugh),
        Reaction(ReactionKind.WOW, "\uD83D\uDE2E", R.string.reaction_wow),
        Reaction(ReactionKind.SAD, "\uD83D\uDE22", R.string.reaction_sad),
    )

/** How many lines of a post the feed shows before "Sjá meira". */
internal const val BODY_LINES = 5
