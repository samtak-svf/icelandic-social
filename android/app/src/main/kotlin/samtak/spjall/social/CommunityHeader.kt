package samtak.spjall.social

import android.content.Intent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.Community
import samtak.spjall.core.CommunityAudience
import samtak.spjall.core.CommunityMember
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.Avatar
import samtak.spjall.ui.AvatarKind
import samtak.spjall.ui.Palette

/**
 * The top of a community (0080): a cover band, the picture overlapping it, the name, the audience line, up to
 * [MEMBER_PICTURES] member pictures and "Bjóða", which shares the community's address from the system sheet.
 */
@Composable
internal fun CommunityHeader(
    community: Community,
    members: List<CommunityMember>,
    onInfo: () -> Unit,
) {
    Box(modifier = Modifier.fillMaxWidth().padding(bottom = PICTURE_OVERLAP.dp)) {
        // The cover is a plain band until the core can fetch the image of a community.
        Box(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .height(COVER_HEIGHT.dp)
                    .background(Palette.secondarySubtle, RoundedCornerShape(COVER_RADIUS.dp))
                    .semantics { contentDescription = "" },
        )
        Avatar(
            name = community.name,
            kind = AvatarKind.Group,
            size = PICTURE.dp,
            modifier =
                Modifier
                    .align(Alignment.BottomStart)
                    .offset(x = 16.dp, y = PICTURE_OVERLAP.dp)
                    .border(BorderStroke(PICTURE_BORDER.dp, Palette.bg), CircleShape),
        )
    }
    Spacer(Modifier.height(PICTURE_OVERLAP.dp - 8.dp))
    Text(text = community.name, style = MaterialTheme.typography.headlineSmall)
    AudienceLine(community, onInfo)
    if (members.isNotEmpty()) {
        Row(
            modifier = Modifier.semantics { contentDescription = "" },
            horizontalArrangement = Arrangement.spacedBy((-MEMBER_OVERLAP).dp),
        ) {
            members.take(MEMBER_PICTURES).forEach {
                Avatar(
                    name = it.name,
                    kind = if (it.verified) AvatarKind.Verified else AvatarKind.Unverified,
                    size = MEMBER_PICTURE.dp,
                    modifier = Modifier.border(BorderStroke(2.dp, Palette.bg), CircleShape),
                )
            }
        }
    }
    if (community.role != null) {
        val context = LocalContext.current
        OutlinedButton(
            onClick = {
                val send =
                    Intent(Intent.ACTION_SEND)
                        .setType("text/plain")
                        .putExtra(Intent.EXTRA_TEXT, SocialLinks.community(community.communityId))
                context.startActivity(Intent.createChooser(send, null))
            },
            modifier = Modifier.heightIn(min = 44.dp),
        ) { Text(stringResource(R.string.invite)) }
    }
}

/** "Lokað samfélag · 12 meðlimir", with a lock in front of a private community; a tap opens the members. */
@Composable
private fun AudienceLine(
    community: Community,
    onInfo: () -> Unit,
) {
    val private = community.audience != CommunityAudience.OPEN
    val audience = stringResource(if (private) R.string.community_private_full else R.string.community_open_full)
    val members =
        community.memberCount?.let { pluralStringResource(R.plurals.community_members, it.toInt(), it.toLong()) }
    Row(
        modifier = Modifier.clickable(role = Role.Button, onClick = onInfo),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (private) {
            Icon(
                AppIcons.Lock,
                contentDescription = null,
                tint = Palette.mutedFg,
                modifier = Modifier.size(14.dp),
            )
        }
        Text(
            text = listOfNotNull(audience, members).joinToString(" · "),
            style = MaterialTheme.typography.bodyMedium,
            color = Palette.mutedFg,
        )
    }
}

private const val COVER_HEIGHT = 110
private const val COVER_RADIUS = 14
private const val PICTURE = 72
private const val PICTURE_OVERLAP = 36
private const val PICTURE_BORDER = 3
private const val MEMBER_PICTURES = 5
private const val MEMBER_PICTURE = 30
private const val MEMBER_OVERLAP = 8
