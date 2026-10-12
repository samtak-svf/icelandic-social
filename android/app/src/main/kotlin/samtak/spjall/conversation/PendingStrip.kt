package samtak.spjall.conversation

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Info
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import samtak.spjall.brand.R
import samtak.spjall.media.decodePhoto
import samtak.spjall.ui.Palette
import java.io.File

/**
 * The photo or file waiting above the field until it is sent (0048): a small
 * picture of the photo, or the file's name, and a button that takes it away.
 */
@Composable
internal fun PendingStrip(
    pending: ConversationViewModel.Pending,
    onRemove: () -> Unit,
) {
    val name = pending.name ?: File(pending.path).name
    val description =
        if (pending.photo) {
            stringResource(R.string.attachment_pending_photo)
        } else {
            stringResource(R.string.attachment_pending_file, name)
        }
    Row(
        modifier = Modifier.fillMaxWidth().padding(start = 16.dp, top = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(modifier = Modifier.weight(1f).clearAndSetSemantics { contentDescription = description }) {
            if (pending.photo) Thumbnail(pending.path) else FileName(name)
        }
        IconButton(onClick = onRemove) {
            Icon(Icons.Filled.Close, contentDescription = stringResource(R.string.attachment_remove), tint = Palette.fg)
        }
    }
}

@Composable
private fun Thumbnail(path: String) {
    val longest = with(LocalDensity.current) { THUMBNAIL.dp.roundToPx() * 2 }
    val bitmap by produceState<ImageBitmap?>(null, path) {
        value = withContext(Dispatchers.IO) { decodePhoto(path, longest)?.asImageBitmap() }
    }
    val shape = RoundedCornerShape(THUMBNAIL_RADIUS.dp)
    val modifier = Modifier.size(THUMBNAIL.dp).clip(shape)
    bitmap?.let {
        Image(bitmap = it, contentDescription = null, contentScale = ContentScale.Crop, modifier = modifier)
    } ?: Box(modifier = modifier.background(Palette.muted))
}

@Composable
private fun FileName(name: String) {
    Row(
        modifier =
            Modifier
                .background(Palette.muted, RoundedCornerShape(THUMBNAIL_RADIUS.dp))
                .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Filled.Info, contentDescription = null, tint = Palette.fg)
        Spacer(Modifier.width(8.dp))
        Text(
            text = name,
            style = MaterialTheme.typography.bodyMedium,
            color = Palette.fg,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

private const val THUMBNAIL = 56
private const val THUMBNAIL_RADIUS = 10
