package samtak.spjall.conversation

import android.text.format.Formatter
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Info
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import samtak.spjall.conversation.ConversationViewModel.Media
import samtak.spjall.core.Content
import samtak.spjall.core.Item
import samtak.spjall.media.rememberPhoto
import samtak.spjall.ui.Palette
import samtak.spjall.ui.lastLine

/** A photo of the information screen's grid (0055): square, fetched when it first shows, opened by a tap. */
@Composable
internal fun SharedPhoto(
    item: Item,
    media: Media?,
    actions: ConversationInfoActions,
) {
    LaunchedEffect(item.seq) { if (media == null) actions.fetch(item) }
    val longest = with(LocalDensity.current) { CELL.dp.roundToPx() }
    val path = (media as? Media.Ready)?.path
    val bitmap = rememberPhoto(path, longest)
    val description = lastLine(item)
    Box(
        modifier =
            Modifier
                .aspectRatio(1f)
                .background(Palette.muted)
                .clickable(role = Role.Image, onClickLabel = description) { actions.open(item) },
        contentAlignment = Alignment.Center,
    ) {
        val shown = bitmap
        if (shown != null) {
            Image(
                bitmap = shown,
                contentDescription = description,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        } else if (media == Media.Loading) {
            CircularProgressIndicator(modifier = Modifier.size(SPINNER.dp))
        }
    }
}

/** A file of the information screen (0055): its name and size, opened by a tap. */
@Composable
internal fun SharedFile(
    item: Item,
    media: Media?,
    actions: ConversationInfoActions,
) {
    val content = item.content as? Content.Media ?: return
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = ROW.dp)
                .clickable(role = Role.Button) { actions.open(item) }
                .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (media == Media.Loading) {
            CircularProgressIndicator(modifier = Modifier.size(SPINNER.dp))
        } else {
            Icon(Icons.Filled.Info, contentDescription = null, tint = Palette.mutedFg)
        }
        Column {
            Text(
                text = content.name ?: lastLine(item),
                style = MaterialTheme.typography.bodyLarge,
                color = Palette.fg,
            )
            Text(
                text = Formatter.formatShortFileSize(LocalContext.current, content.size.toLong()),
                style = MaterialTheme.typography.bodySmall,
                color = Palette.mutedFg,
            )
        }
    }
}

internal fun Item.isPhoto() = (content as? Content.Media)?.mime?.startsWith("image/") == true

private const val CELL = 160
private const val SPINNER = 24
private const val ROW = 56
