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
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.BrandTokens.Radius
import samtak.spjall.brand.R
import samtak.spjall.core.Community
import samtak.spjall.core.CommunityAudience
import samtak.spjall.core.CommunityMember
import samtak.spjall.core.FrameKind
import samtak.spjall.frames.LocalFrameRules
import samtak.spjall.frames.windowWidthDp
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.Avatar
import samtak.spjall.ui.AvatarKind
import samtak.spjall.ui.CoverImage
import samtak.spjall.ui.Palette
import samtak.spjall.ui.PhotoOf
import samtak.spjall.ui.communityTile
import samtak.spjall.ui.coverOf
import samtak.spjall.ui.currentLayout
import samtak.spjall.ui.pictureOf

/**
 * The top of a community (0080): a cover band, the picture overlapping it, the name, the audience line, up to
 * the layout's count of member pictures and "Bjóða", which shares the community's address from the system sheet.
 */
@Composable
internal fun CommunityHeader(
    community: Community,
    members: List<CommunityMember>,
    onInfo: () -> Unit,
) {
    Box(modifier = Modifier.fillMaxWidth().padding(bottom = PICTURE_OVERLAP.dp)) {
        CoverBand(community.coverOf(), stringResource(R.string.community_cover_alt))
        Avatar(
            name = community.name,
            kind = AvatarKind.Group,
            size = PICTURE.dp,
            photo = community.pictureOf(),
            shape = communityTile(PICTURE.dp),
            modifier =
                Modifier
                    .align(Alignment.BottomStart)
                    .offset(x = 16.dp, y = PICTURE_OVERLAP.dp)
                    .border(BorderStroke(PICTURE_BORDER.dp, Palette.bg), communityTile(PICTURE.dp)),
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
            members.take(currentLayout().memberPictures).forEach {
                Avatar(
                    it,
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

/** The cover across the top: a plain band when the community has none. */
@Composable
internal fun CoverBand(
    photo: PhotoOf?,
    alt: String,
) {
    val rules = LocalFrameRules.current
    val band = RoundedCornerShape(Radius.CARD_DP.dp)
    val frame = rules.frameForWidth(FrameKind.COVER, windowWidthDp())
    val aspect = rules.aspect(FrameKind.COVER, frame)
    Box(
        modifier =
            Modifier
                .fillMaxWidth()
                .aspectRatio(aspect.w.toFloat() / aspect.h)
                .clip(band)
                .background(Palette.secondarySubtle, band),
    ) {
        CoverImage(photo, alt, Modifier.fillMaxSize())
    }
}

/** `community_private_full` and the count, with a lock in front of a private community; a tap opens the members. */
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

private const val PICTURE = 72
private const val PICTURE_OVERLAP = 36
private const val PICTURE_BORDER = 3
private const val MEMBER_PICTURE = 30
private const val MEMBER_OVERLAP = 8
