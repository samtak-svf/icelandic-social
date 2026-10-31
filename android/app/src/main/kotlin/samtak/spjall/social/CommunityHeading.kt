package samtak.spjall.social

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import samtak.spjall.core.Author
import samtak.spjall.core.Community
import samtak.spjall.ui.Avatar
import samtak.spjall.ui.AvatarKind
import samtak.spjall.ui.Palette
import samtak.spjall.ui.communityTile
import samtak.spjall.ui.photoOf
import samtak.spjall.ui.pictureOf
import samtak.spjall.ui.shownName

/**
 * The heading of a post shown outside its community (decision 0116): the community first, with the author's small
 * picture, name and the time under it. Inside a community, and for a wall post, the heading is the author's.
 */
@Composable
internal fun CommunityHeading(
    community: Community,
    author: Author?,
    anonymousRes: Int?,
    createdAt: ULong,
    trailing: @Composable () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Avatar(
            name = community.name,
            kind = AvatarKind.Group,
            size = 40.dp,
            photo = community.pictureOf(),
            shape = communityTile(40.dp),
        )
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                text = community.name,
                style = MaterialTheme.typography.titleSmall,
                color = Palette.fg,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Avatar(
                    name = author?.name,
                    kind = if (author?.verified == true) AvatarKind.Verified else AvatarKind.Unverified,
                    size = 20.dp,
                    photo = author?.photoOf(),
                )
                val name = anonymousRes?.let { stringResource(it) } ?: author?.shownName().orEmpty()
                Text(
                    text = "$name · ${agoText(createdAt)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = Palette.mutedFg,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        trailing()
    }
}
