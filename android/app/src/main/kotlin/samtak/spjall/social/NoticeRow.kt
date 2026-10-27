package samtak.spjall.social

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.Author
import samtak.spjall.core.Community
import samtak.spjall.core.SocialNotification
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.Avatar
import samtak.spjall.ui.AvatarKind
import samtak.spjall.ui.Palette
import samtak.spjall.ui.communityTile
import samtak.spjall.ui.photoOf
import samtak.spjall.ui.pictureOf

/**
 * One notification (decisions 0103 to 0106): the picture with its badge, the community's name, the sentence
 * [line] chose, the snippet when there is one, and how long ago. An unread row is tinted and carries a dot.
 */
@Composable
fun NoticeRow(
    notification: SocialNotification,
    community: Community?,
    actions: NotificationsActions,
    modifier: Modifier = Modifier,
) {
    val unread = !notification.read
    val line = notification.line()
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .background(if (unread) Palette.primarySubtle else Palette.surface, ROW_SHAPE)
                .border(1.dp, Palette.border, ROW_SHAPE)
                .clickable(role = Role.Button) { actions.open(notification) }
                .padding(start = 12.dp, top = 12.dp, bottom = 12.dp, end = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        NoticePicture(notification, community)
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            community?.let {
                Text(
                    text = it.name,
                    style = MaterialTheme.typography.labelSmall,
                    color = Palette.mutedFg,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Text(text = line.text(LocalContext.current.resources), style = MaterialTheme.typography.bodyLarge)
            notification.snippet?.let {
                Text(
                    text = stringResource(R.string.notice_snippet, it),
                    style = MaterialTheme.typography.bodyMedium,
                    color = Palette.mutedFg,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Text(
                text = agoText(notification.createdAt),
                style = MaterialTheme.typography.bodySmall,
                color = Palette.mutedFg,
            )
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            NoticeMenu(notification, actions)
            if (unread) Box(modifier = Modifier.size(DOT.dp).clip(CircleShape).background(Palette.primary))
        }
    }
}

/**
 * The newest actor's avatar, a second one behind it when two or more acted, or the community's picture when no
 * one did; with the [NoticeBadge] on its corner.
 */
@Composable
private fun NoticePicture(
    notification: SocialNotification,
    community: Community?,
) {
    val people = notification.actors.ifEmpty { listOfNotNull(notification.actor) }
    val second = people.getOrNull(1).takeIf { notification.actorCount >= 2uL }
    Box(modifier = Modifier.width(if (second != null) PICTURE_TWO.dp else PICTURE.dp)) {
        if (second != null) PersonAvatar(second, Modifier.offset(x = OVERLAP.dp))
        val first = people.firstOrNull()
        if (first != null) {
            PersonAvatar(first, Modifier.border(2.dp, Palette.surface, CircleShape))
        } else {
            Avatar(
                name = community?.name,
                kind = AvatarKind.Group,
                size = PICTURE.dp,
                photo = community?.pictureOf(),
                shape = communityTile(PICTURE.dp),
            )
        }
        Badge(notification.line().badge, notification.emoji, Modifier.align(Alignment.BottomEnd))
    }
}

@Composable
private fun PersonAvatar(
    author: Author,
    modifier: Modifier = Modifier,
    size: Dp = PICTURE.dp,
) {
    Avatar(
        name = author.name,
        modifier = modifier,
        kind = if (author.verified) AvatarKind.Verified else AvatarKind.Unverified,
        size = size,
        photo = author.photoOf(),
    )
}

@Composable
private fun Badge(
    badge: NoticeBadge,
    emoji: String?,
    modifier: Modifier,
) {
    Box(
        modifier =
            modifier
                .size(BADGE.dp)
                .background(Palette.surface, CircleShape)
                .border(1.dp, Palette.border, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        when {
            badge == NoticeBadge.EMOJI && emoji != null -> // In dp, not sp: the badge keeps its size when the text is scaled.
            Text(text = emoji, fontSize = with(LocalDensity.current) { EMOJI_SIZE.dp.toSp() })
            else -> {
                val icon =
                    when (badge) {
                        NoticeBadge.APPROVED -> AppIcons.Check
                        NoticeBadge.MODERATOR -> AppIcons.Shield
                        else -> AppIcons.Chat
                    }
                Icon(icon, contentDescription = null, modifier = Modifier.size(ICON.dp), tint = Palette.primary)
            }
        }
    }
}

private val ROW_SHAPE = androidx.compose.foundation.shape.RoundedCornerShape(12.dp)
private const val PICTURE = 44
private const val PICTURE_TWO = 60
private const val OVERLAP = 16
private const val BADGE = 20
private const val ICON = 12
private const val EMOJI_SIZE = 12
private const val DOT = 8
