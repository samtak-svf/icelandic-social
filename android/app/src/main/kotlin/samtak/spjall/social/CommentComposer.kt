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
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.Avatar
import samtak.spjall.ui.AvatarKind
import samtak.spjall.ui.ComposerField
import samtak.spjall.ui.Palette
import samtak.spjall.ui.RoundButton

/**
 * The one row a comment is written in, pinned to the foot of the post (0080): the reader's own avatar, a field
 * that grows up to five lines, a photo button and the send button, enabled only while there is something to send.
 * The one image a comment takes (0082) shows above the row with an X, and why one was refused shows under it.
 */
@Composable
fun CommentComposer(
    me: OwnAccount?,
    draft: String,
    sending: Boolean,
    onText: (String) -> Unit,
    onSend: () -> Unit,
    modifier: Modifier = Modifier,
    image: String? = null,
    notice: CommunityViewModel.ImageNotice? = null,
    onAddImage: () -> Unit = {},
    onRemoveImage: () -> Unit = {},
) {
    val ready = (draft.isNotBlank() || image != null) && !sending
    // At a large text size the field would be left too narrow for its own hint, so the photo button goes above it.
    val roomy = LocalDensity.current.fontScale <= ROOMY_SCALE
    val photo = @Composable { PhotoButton(sending, onAddImage) }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (image != null) {
            PickedImages(listOf(image)) { onRemoveImage() }
        }
        notice?.let {
            Text(text = it.text(), style = MaterialTheme.typography.bodyMedium, color = Palette.danger)
        }
        if (!roomy) photo()
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Avatar(name = me?.name, kind = AvatarKind.Me, size = 36.dp, photo = me?.photo)
            ComposerField(draft, onText, stringResource(R.string.post_write_comment), modifier.weight(1f))
            if (roomy) photo()
            RoundButton(
                icon = AppIcons.Send,
                description = stringResource(R.string.comment_publish),
                onClick = onSend,
                enabled = ready,
                fill = if (ready) Palette.primary else Palette.muted,
                tint = if (ready) Palette.primaryFg else Palette.mutedFg,
                size = 40.dp,
            )
        }
    }
}

@Composable
private fun PhotoButton(
    sending: Boolean,
    onClick: () -> Unit,
) = RoundButton(
    icon = AppIcons.Photo,
    description = stringResource(R.string.comment_add_image),
    onClick = onClick,
    enabled = !sending,
    fill = Palette.muted,
    tint = if (sending) Palette.mutedFg else Palette.fg,
    size = 40.dp,
)

/** The largest text scale at which the photo button still fits beside the field. */
private const val ROOMY_SCALE = 1.3f
