package samtak.spjall.conversation

import android.text.format.Formatter
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
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
import samtak.spjall.ui.Palette
import samtak.spjall.ui.lastLine

/**
 * Whether [item] is drawn edge to edge in its bubble (0053): a photo that has not failed to
 * download. The bubble's padding then goes round its caption only.
 */
internal fun Item.edgeToEdge(media: Media?): Boolean =
    (content as? Content.Media)?.mime?.startsWith("image/") == true && media != Media.Failed

/** A photo with nothing round it, drawn as the photo alone with the bubble's shape and no frame. */
internal fun Item.bare(media: Media?): Boolean =
    edgeToEdge(media) && (content as? Content.Media)?.caption == null && !forwarded

/** The bubble's colour; none for a photo with nothing round it (0053). */
@Composable
internal fun bubbleColor(
    item: Item,
    media: ConversationViewModel.Media?,
) = when {
    item.bare(media) -> Color.Transparent
    item.own -> Palette.bubbleOwnBg
    else -> Palette.bubbleOtherBg
}

/** What the bubble holds. A photo reaches its edges (0053), so only what is round it is padded. */
@Composable
internal fun Inside(
    item: Item,
    media: ConversationViewModel.Media?,
    foreground: Color,
    actions: ConversationActions,
    onTap: () -> Unit,
    onLongPress: () -> Unit,
) {
    val edge = item.edgeToEdge(media)
    Column(modifier = if (edge) Modifier else Modifier.padding(horizontal = PAD_X.dp, vertical = PAD_Y.dp)) {
        if (item.forwarded) {
            Box(modifier = if (edge) Modifier.padding(start = PAD_X.dp, end = PAD_X.dp, top = PAD_Y.dp) else Modifier) {
                ForwardedMark(foreground)
            }
        }
        Body(item, media, foreground, actions, onTap, onLongPress)
    }
}

/**
 * A photo or file in a bubble. A photo downloads as soon as its bubble shows;
 * a file waits for a tap, which opens it in another app either way.
 * A photo fills the bubble, which clips it to its shape; a caption wraps at the photo's width.
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
    if (item.edgeToEdge(media)) {
        Column(modifier = Modifier.width(IntrinsicSize.Min)) {
            Photo(media, item)
            content.caption?.let {
                Text(
                    text = it,
                    style = MaterialTheme.typography.bodyLarge,
                    color = foreground,
                    modifier = Modifier.padding(horizontal = PAD_X.dp, vertical = PAD_Y.dp),
                )
            }
        }
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        if (media == Media.Failed) Failed(item, foreground, actions) else FileRow(item, media, foreground)
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
    bitmap?.let {
        Image(
            bitmap = it,
            contentDescription = lastLine(item),
            contentScale = ContentScale.Fit,
            modifier = Modifier.fillMaxWidth().heightIn(max = PHOTO_SIZE.dp),
        )
    } ?: Box(
        modifier = Modifier.size(PHOTO_SIZE.dp / 2).background(Palette.muted),
        contentAlignment = Alignment.Center,
    ) {
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
        val content = item.content as? Content.Media
        Column {
            Text(
                text = content?.name ?: lastLine(item),
                style = MaterialTheme.typography.bodyLarge,
                color = foreground,
            )
            content?.let {
                Text(
                    text = Formatter.formatShortFileSize(LocalContext.current, it.size.toLong()),
                    style = MaterialTheme.typography.bodySmall,
                    color = foreground,
                )
            }
        }
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
private const val ICON_SIZE = 24
