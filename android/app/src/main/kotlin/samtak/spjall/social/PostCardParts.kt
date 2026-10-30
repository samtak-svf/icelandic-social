package samtak.spjall.social

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.conversation.EmojiPickerSheet
import samtak.spjall.core.Author
import samtak.spjall.core.AuthorRole
import samtak.spjall.core.Comment
import samtak.spjall.core.Post
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.Avatar
import samtak.spjall.ui.AvatarKind
import samtak.spjall.ui.NameWithMark
import samtak.spjall.ui.Palette
import samtak.spjall.ui.photoOf

/** The role badge text of an author in a community, or null for a plain member. */
internal fun AuthorRole?.badge(): Int? =
    when (this) {
        AuthorRole.OWNER -> R.string.community_role_owner
        AuthorRole.MODERATOR -> R.string.community_role_moderator
        else -> null
    }

/** "Stjórnandi" or "Eigandi" in a small pill, or nothing. */
@Composable
internal fun RoleBadge(role: AuthorRole?) {
    val text = role.badge() ?: return
    Text(
        text = stringResource(text),
        style = MaterialTheme.typography.labelSmall,
        color = Palette.primary,
        modifier =
            Modifier
                .background(Palette.primarySubtle, RoundedCornerShape(PILL.dp))
                .padding(horizontal = 8.dp, vertical = 2.dp),
    )
}

/** Who wrote it: picture, name with the role badge, how long ago; [trailing] sits on the right. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun AuthorRow(
    author: Author?,
    anonymousRes: Int?,
    createdAt: ULong,
    trailing: @Composable () -> Unit = {},
) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Avatar(
            name = author?.name,
            kind = if (author?.verified == true) AvatarKind.Verified else AvatarKind.Unverified,
            size = 40.dp,
            photo = author?.photoOf(),
        )
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            // The mark rides on the name's last word; a name that wraps sends the badge to the next line.
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
                itemVerticalAlignment = Alignment.CenterVertically,
            ) {
                NameWithMark(
                    name = anonymousRes?.let { stringResource(it) } ?: author?.shownName().orEmpty(),
                    verified = author?.verified == true,
                    style = MaterialTheme.typography.titleSmall,
                    color = Palette.fg,
                )
                author?.let { RoleBadge(it.role) }
            }
            Text(text = agoText(createdAt), style = MaterialTheme.typography.bodySmall, color = Palette.mutedFg)
        }
        trailing()
    }
}

/** "Fest færsla": the mark on the post a moderator pinned to the top of the community. */
@Composable
internal fun PinnedMarker() {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Icon(AppIcons.Pin, contentDescription = null, tint = Palette.mutedFg, modifier = Modifier.size(14.dp))
        Text(
            text = stringResource(R.string.post_pinned),
            style = MaterialTheme.typography.labelMedium,
            color = Palette.mutedFg,
        )
    }
}

/** The reactions used, most given first, with their total, and the comment count at the other end. */
@Composable
internal fun ReactionSummary(
    post: Post,
    onOpen: (() -> Unit)?,
) {
    val total = post.emojis.sumOf { it.count.toLong() }
    val comments = post.commentCount.toLong()
    if (total == 0L && comments == 0L) return
    val emojis = post.summaryEmojis(SUMMARY_KINDS)
    Row(verticalAlignment = Alignment.CenterVertically) {
        if (total > 0L) {
            Text(text = "$emojis $total", style = MaterialTheme.typography.bodyMedium, color = Palette.mutedFg)
        }
        Spacer(Modifier.weight(1f))
        if (comments > 0L) {
            val label = pluralStringResource(R.plurals.post_comments, comments.toInt(), comments)
            Text(
                text = label,
                style = MaterialTheme.typography.bodyMedium,
                color = Palette.mutedFg,
                modifier = if (onOpen != null) Modifier.clickable(role = Role.Button, onClick = onOpen) else Modifier,
            )
        }
    }
}

/**
 * Líkar / Athugasemd / Deila, three equal actions. A tap on Líkar is the thumb on or off (or takes back whatever
 * this account reacted with); a long press offers the quick bar (0063).
 */
@Composable
internal fun PostActions(
    post: Post,
    busy: Boolean,
    onReact: (String) -> Unit,
    onComment: () -> Unit,
    onShare: () -> Unit,
) {
    val like: @Composable (Modifier) -> Unit = { LikeAction(post, busy, onReact, it) }
    val comment: @Composable (Modifier) -> Unit = {
        ActionLabel(
            stringResource(R.string.post_comment_action),
            null,
            false,
            it.clickable(role = Role.Button, onClick = onComment),
        )
    }
    val share: @Composable (Modifier) -> Unit = {
        ActionLabel(stringResource(R.string.share), null, false, it.clickable(role = Role.Button, onClick = onShare))
    }
    // Three equal columns, unless the text is so large that a word would be cut: then one under the other.
    if (LocalDensity.current.fontScale > STACK_FONT_SCALE) {
        Column(modifier = Modifier.fillMaxWidth()) {
            like(Modifier)
            comment(Modifier)
            share(Modifier)
        }
    } else {
        Row(modifier = Modifier.fillMaxWidth()) {
            like(Modifier.weight(1f))
            comment(Modifier.weight(1f))
            share(Modifier.weight(1f))
        }
    }
}

/** Líkar: a tap is the thumb on or off, a long press offers the quick bar. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun LikeAction(
    post: Post,
    busy: Boolean,
    onReact: (String) -> Unit,
    modifier: Modifier,
) {
    var picker by remember { mutableStateOf(false) }
    var all by remember { mutableStateOf(false) }
    val title = stringResource(R.string.reactions_title)
    val mine = post.myEmoji
    Box(modifier = modifier) {
        ActionLabel(
            text = stringResource(R.string.post_like),
            emoji = mine ?: LIKE_EMOJI,
            active = mine != null,
            modifier =
                Modifier
                    .combinedClickable(
                        enabled = !busy && !suspended(),
                        role = Role.Button,
                        onClick = { onReact(post.myEmoji ?: LIKE_EMOJI) },
                        onLongClick = { picker = true },
                    ).semantics {
                        customActions =
                            listOf(
                                CustomAccessibilityAction(title) {
                                    picker = true
                                    true
                                },
                            )
                    },
        )
        ReactionPicker(picker, { picker = false }, { all = true }, onReact)
        if (all) EmojiPickerSheet(onPick = onReact, onDismiss = { all = false })
    }
}

@Composable
private fun ActionLabel(
    text: String,
    emoji: String?,
    active: Boolean,
    modifier: Modifier,
) {
    Row(
        modifier = modifier.heightIn(min = TOUCH.dp).fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (emoji != null) Text(text = emoji, style = MaterialTheme.typography.titleMedium)
        Text(
            text = text,
            style = MaterialTheme.typography.labelLarge,
            color = if (active) Palette.primary else Palette.mutedFg,
            fontWeight = if (active) FontWeight.Bold else null,
        )
    }
}

/** The newest comment under a post in the feed: its author's picture and name, and one or two lines of it. */
@Composable
internal fun CommentPreview(comment: Comment) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Avatar(
            name = comment.author.name,
            kind = if (comment.author.verified) AvatarKind.Verified else AvatarKind.Unverified,
            size = 28.dp,
            photo = comment.author.photoOf(),
        )
        Column(
            modifier =
                Modifier
                    .weight(1f)
                    .background(Palette.secondarySubtle, RoundedCornerShape(BUBBLE_RADIUS.dp))
                    .padding(horizontal = 12.dp, vertical = 8.dp),
        ) {
            Text(text = comment.author.shownName(), style = MaterialTheme.typography.labelLarge)
            Text(
                text = comment.body,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = PREVIEW_LINES,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/** "Skrifaðu athugasemd…": the pill that opens the post with the comment field ready. */
@Composable
internal fun WriteCommentPill(onComment: () -> Unit) {
    Text(
        text = stringResource(R.string.post_write_comment),
        style = MaterialTheme.typography.bodyMedium,
        color = Palette.mutedFg,
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = TOUCH.dp)
                .background(Palette.secondarySubtle, RoundedCornerShape(PILL.dp))
                .clickable(role = Role.Button, onClick = onComment)
                .padding(horizontal = 16.dp, vertical = 12.dp),
    )
}

internal const val BUBBLE_RADIUS = 16
private const val SUMMARY_KINDS = 3
private const val STACK_FONT_SCALE = 1.3f
private const val PREVIEW_LINES = 2

/** The quick bar in a row over the Líkar action, and a plus that opens every emoji (0063, 0100). */
@Composable
private fun ReactionPicker(
    open: Boolean,
    onDismiss: () -> Unit,
    onMore: () -> Unit,
    onReact: (String) -> Unit,
) {
    val title = stringResource(R.string.reactions_title)
    DropdownMenu(expanded = open, onDismissRequest = onDismiss) {
        Row(
            modifier = Modifier.padding(horizontal = 8.dp).semantics { contentDescription = title },
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            REACTIONS.forEach { reaction ->
                val name = stringResource(reaction.label)
                Text(
                    text = reaction.emoji,
                    style = MaterialTheme.typography.headlineSmall,
                    modifier =
                        Modifier
                            .heightIn(min = TOUCH.dp)
                            .widthIn(min = TOUCH.dp)
                            .clickable(role = Role.Button) {
                                onDismiss()
                                onReact(reaction.emoji)
                            }.clearAndSetSemantics { contentDescription = name }
                            .padding(8.dp),
                )
            }
            val more = stringResource(R.string.react_any)
            Text(
                text = "+",
                style = MaterialTheme.typography.headlineSmall,
                modifier =
                    Modifier
                        .heightIn(min = TOUCH.dp)
                        .widthIn(min = TOUCH.dp)
                        .clickable(role = Role.Button) {
                            onDismiss()
                            onMore()
                        }.clearAndSetSemantics { contentDescription = more }
                        .padding(8.dp),
            )
        }
    }
}
