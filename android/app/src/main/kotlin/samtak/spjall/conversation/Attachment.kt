package samtak.spjall.conversation

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Info
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import samtak.spjall.brand.R
import samtak.spjall.conversation.ConversationViewModel.Media
import samtak.spjall.core.Content
import samtak.spjall.core.Item
import samtak.spjall.media.decodePhoto
import samtak.spjall.ui.lastLine

/**
 * A photo or file in a bubble. A photo downloads as soon as its bubble shows;
 * a file waits for a tap, which opens it in another app either way.
 */
@Composable
internal fun Attachment(
    item: Item,
    content: Content.Media,
    media: Media?,
    foreground: Color,
    actions: ConversationActions,
) {
    val photo = content.mime.startsWith("image/")
    if (photo) {
        LaunchedEffect(item.seq) { if (media == null) actions.fetch(item) }
    }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        when {
            media == Media.Failed -> Failed(item, foreground, actions)
            photo -> Photo(media, item)
            else -> FileRow(item, media, foreground)
        }
        content.caption?.let {
            Text(text = it, style = MaterialTheme.typography.bodyLarge, color = foreground)
        }
    }
}

@Composable
private fun Photo(
    media: Media?,
    item: Item,
) {
    val longest = with(LocalDensity.current) { PHOTO_SIZE.dp.roundToPx() }
    val path = (media as? Media.Ready)?.path
    val bitmap by produceState<ImageBitmap?>(null, path) {
        value = path?.let { withContext(Dispatchers.IO) { decodePhoto(it, longest)?.asImageBitmap() } }
    }
    val shape = RoundedCornerShape(PHOTO_RADIUS.dp)
    bitmap?.let {
        Image(
            bitmap = it,
            contentDescription = lastLine(item),
            contentScale = ContentScale.Fit,
            modifier = Modifier.heightIn(max = PHOTO_SIZE.dp).clip(shape),
        )
    } ?: Box(modifier = Modifier.size(PHOTO_SIZE.dp / 2), contentAlignment = Alignment.Center) {
        CircularProgressIndicator()
    }
}

@Composable
private fun FileRow(
    item: Item,
    media: Media?,
    foreground: Color,
) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        if (media == Media.Loading) {
            CircularProgressIndicator(modifier = Modifier.size(ICON_SIZE.dp), color = foreground)
        } else {
            Icon(Icons.Filled.Info, contentDescription = null, tint = foreground)
        }
        Text(text = lastLine(item), style = MaterialTheme.typography.bodyLarge, color = foreground)
    }
}

@Composable
private fun Failed(
    item: Item,
    foreground: Color,
    actions: ConversationActions,
) {
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Text(
            text = stringResource(R.string.media_download_failed),
            style = MaterialTheme.typography.bodyMedium,
            color = foreground,
        )
        TextButton(onClick = { actions.fetch(item) }) { Text(stringResource(R.string.try_again), color = foreground) }
    }
}

private const val PHOTO_SIZE = 240
private const val PHOTO_RADIUS = 8
private const val ICON_SIZE = 24
