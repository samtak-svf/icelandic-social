package samtak.spjall.social

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
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
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.Community
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.Avatar
import samtak.spjall.ui.AvatarKind
import samtak.spjall.ui.Palette

/**
 * A community in a list (0080): its picture, its name and a line, and when it last had a post. With posts not yet
 * seen the name is bold, the line counts them and a dot sits at the end. A tap opens it; a long press, or the
 * more button, offers to pin it when [onPin] is given.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun CommunityRow(
    community: Community,
    onOpen: () -> Unit,
    onPin: ((Boolean) -> Unit)? = null,
) {
    var menu by remember { mutableStateOf(false) }
    val pinLabel = stringResource(if (community.pinned) R.string.community_unpin else R.string.community_pin)
    val unread = community.unread.toLong()
    SocialCard(
        modifier =
            Modifier
                .combinedClickable(
                    role = Role.Button,
                    onClick = onOpen,
                    onLongClick = onPin?.let { { menu = true } },
                ).semantics {
                    // The long press has a spoken twin for a screen reader.
                    if (onPin != null) {
                        customActions =
                            listOf(
                                CustomAccessibilityAction(pinLabel) {
                                    onPin(!community.pinned)
                                    true
                                },
                            )
                    }
                },
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Avatar(name = community.name, kind = AvatarKind.Group, size = 40.dp)
            CommunityRowText(community, unread, Modifier.weight(1f))
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                community.lastPostAt?.let {
                    Text(text = agoText(it), style = MaterialTheme.typography.bodySmall, color = Palette.mutedFg)
                }
                if (unread > 0) Box(Modifier.size(10.dp).background(Palette.primary, CircleShape))
            }
            if (onPin != null) PinMenu(community.pinned, menu, { menu = it }, onPin)
        }
    }
}

/** The name (bold with unread posts, a pin in front when pinned) and the line under it. */
@Composable
private fun CommunityRowText(
    community: Community,
    unread: Long,
    modifier: Modifier,
) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            if (community.pinned) {
                Icon(
                    AppIcons.Pin,
                    contentDescription = null,
                    tint = Palette.mutedFg,
                    modifier = Modifier.size(14.dp),
                )
            }
            Text(
                text = community.name,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = if (unread > 0) FontWeight.Bold else null,
            )
        }
        if (unread > 0) {
            Text(
                text = pluralStringResource(R.plurals.community_unread_posts, unread.toInt(), unread),
                style = MaterialTheme.typography.bodySmall,
                fontWeight = FontWeight.Bold,
            )
        } else {
            CommunityLine(community)
        }
    }
}

/** The menu a long press on a community row opens: pin or unpin. It takes no room in the row. */
@Composable
private fun PinMenu(
    pinned: Boolean,
    open: Boolean,
    onOpen: (Boolean) -> Unit,
    onPin: (Boolean) -> Unit,
) {
    Box {
        DropdownMenu(expanded = open, onDismissRequest = { onOpen(false) }) {
            DropdownMenuItem(
                text = { Text(stringResource(if (pinned) R.string.community_unpin else R.string.community_pin)) },
                onClick = {
                    onOpen(false)
                    onPin(!pinned)
                },
            )
        }
    }
}
