package samtak.spjall.social

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.BrandTokens.Radius
import samtak.spjall.brand.R
import samtak.spjall.core.Comment
import samtak.spjall.core.ModerationState
import samtak.spjall.core.PostImage
import samtak.spjall.ui.Avatar
import samtak.spjall.ui.AvatarKind
import samtak.spjall.ui.ImageViewer
import samtak.spjall.ui.Palette
import samtak.spjall.ui.ViewerImage
import samtak.spjall.ui.photoOf

/**
 * A comment (0080): a grey bubble with the author's picture, name and role badge, a thumb count on its corner
 * when it has likes, and under it "{time} · Líkar þetta · Svara". A comment taken down shows its tombstone and
 * no actions. [onReply] is null where the comment cannot be replied to.
 */
@Composable
internal fun CommentItem(
    comment: Comment,
    reported: Boolean,
    onReport: () -> Unit,
    onDelete: (() -> Unit)?,
    onLike: () -> Unit,
    onReply: (() -> Unit)?,
    modifier: Modifier = Modifier,
) {
    if (comment.state == ModerationState.REMOVED && comment.body.isEmpty()) {
        Text(
            stringResource(R.string.comment_tombstone),
            style = MaterialTheme.typography.bodyMedium.copy(fontStyle = FontStyle.Italic),
            color = Palette.mutedFg,
            modifier = modifier.padding(vertical = 4.dp),
        )
        return
    }
    Row(modifier = modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Avatar(
            name = comment.author.name,
            kind = if (comment.author.verified) AvatarKind.Verified else AvatarKind.Unverified,
            size = 32.dp,
            photo = comment.author.photoOf(),
            modifier = Modifier.opensPerson(comment.author.accountId),
        )
        Column(modifier = Modifier.weight(1f)) {
            Box {
                CommentBubble(comment)
                if (comment.likes >
                    0uL
                ) {
                    LikeCount(comment.likes, Modifier.align(Alignment.BottomEnd).offset(x = 6.dp, y = 10.dp))
                }
            }
            CommentLine(comment, reported, onReport, onDelete, onLike, onReply)
        }
    }
}

@Composable
private fun CommentBubble(comment: Comment) {
    Column(
        modifier =
            Modifier
                .background(Palette.secondarySubtle, RoundedCornerShape(Radius.POST_BUBBLE_DP.dp))
                .padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        StateMark(comment.state)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                text = comment.author.shownName(),
                style = MaterialTheme.typography.labelLarge,
                modifier = Modifier.opensPerson(comment.author.accountId),
            )
            RoleBadge(comment.author.role)
        }
        if (comment.body.isNotEmpty()) Text(text = comment.body, style = MaterialTheme.typography.bodyMedium)
        comment.images.firstOrNull()?.let { CommentImage(comment.postId, it) }
    }
}

/** A comment's one image (0082) under its text at the bubble's width; a tap opens it in the full-screen viewer. */
@Composable
private fun CommentImage(
    postId: String,
    image: PostImage,
) {
    val description = stringResource(R.string.comment_image_alt)
    var viewing by rememberSaveable(image.mediaId) { mutableStateOf(false) }
    val source = LocalPostImages.current
    if (viewing) {
        ImageViewer(listOf(ViewerImage(image.mediaId, description) { source?.path(postId, image.mediaId) }), 0) {
            viewing = false
        }
    }
    val ratio = if (image.height > 0u) image.width.toFloat() / image.height.toFloat() else 1f
    PostImageView(
        postId,
        image,
        description,
        Modifier.padding(top = 6.dp).fillMaxWidth().aspectRatio(ratio.coerceIn(MIN_RATIO, MAX_RATIO)),
    ) { viewing = true }
}

/** The thumb and how many liked, on the corner of a comment's bubble. */
@Composable
private fun LikeCount(
    likes: ULong,
    modifier: Modifier,
) {
    Row(
        modifier =
            modifier
                .background(Palette.surface, RoundedCornerShape(PILL.dp))
                .border(BorderStroke(1.dp, Palette.border), RoundedCornerShape(PILL.dp))
                .padding(horizontal = 6.dp, vertical = 2.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(text = "\uD83D\uDC4D", style = MaterialTheme.typography.labelSmall)
        Text(text = "$likes", style = MaterialTheme.typography.labelSmall)
    }
}

/** "{time}  Líkar þetta  Svara" and the menu, under a comment's bubble. */
@Composable
private fun CommentLine(
    comment: Comment,
    reported: Boolean,
    onReport: () -> Unit,
    onDelete: (() -> Unit)?,
    onLike: () -> Unit,
    onReply: (() -> Unit)?,
) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        // Wraps, so an action that no longer fits on a narrow screen moves down whole instead of being squeezed.
        FlowRow(
            modifier = Modifier.weight(1f),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            itemVerticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = agoText(comment.createdAt),
                style = MaterialTheme.typography.labelMedium,
                color = Palette.mutedFg,
            )
            Text(
                text = stringResource(R.string.comment_like),
                style = MaterialTheme.typography.labelLarge,
                fontWeight = if (comment.liked) FontWeight.Bold else null,
                color = if (comment.liked) Palette.primary else Palette.mutedFg,
                modifier =
                    Modifier
                        .heightIn(
                            min = TOUCH.dp,
                        ).wrapContentHeight(Alignment.CenterVertically)
                        .clickable(role = Role.Button, onClick = onLike),
            )
            if (onReply != null) {
                Text(
                    text = stringResource(R.string.comment_reply),
                    style = MaterialTheme.typography.labelLarge,
                    color = Palette.mutedFg,
                    modifier =
                        Modifier
                            .heightIn(
                                min = TOUCH.dp,
                            ).wrapContentHeight(
                                Alignment.CenterVertically,
                            ).clickable(role = Role.Button, onClick = onReply),
                )
            }
        }
        CardActions(reported = reported, onReport = onReport, onDelete = onDelete)
    }
}
