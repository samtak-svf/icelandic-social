package samtak.spjall.social

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.withContext
import samtak.spjall.brand.R
import samtak.spjall.core.Post
import samtak.spjall.core.PostImage
import samtak.spjall.media.LocalPhotoDecoding
import samtak.spjall.media.rememberPhoto
import samtak.spjall.ui.Palette

/**
 * Where a post's images come from (decision 0065): the path of the WebP the core keeps, null when it cannot be
 * had now.
 */
fun interface PostImages {
    /** Blocks on the network the first time; called off the main thread. */
    fun path(
        postId: String,
        mediaId: String,
    ): String?
}

/** Null draws a plain box in each image's place, as in a screen test that provides none. */
val LocalPostImages = staticCompositionLocalOf<PostImages?> { null }

/** A post's images under its text: one at its own shape, more two to a row as squares. */
@Composable
fun PostImageGrid(post: Post) {
    val images = post.images
    if (images.isEmpty()) return
    val single = images.singleOrNull()
    if (single != null) {
        val ratio = if (single.height > 0u) single.width.toFloat() / single.height.toFloat() else 1f
        PostImageView(
            post.postId,
            single,
            stringResource(R.string.post_image_alt),
            Modifier.fillMaxWidth().aspectRatio(ratio.coerceIn(MIN_RATIO, MAX_RATIO)),
        )
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(GAP.dp)) {
        images.chunked(2).forEachIndexed { rowIndex, row ->
            Row(horizontalArrangement = Arrangement.spacedBy(GAP.dp)) {
                row.forEachIndexed { column, image ->
                    // Several images are told apart for TalkBack (#355): "Mynd 2 af 3".
                    val description =
                        stringResource(R.string.post_image_alt_numbered, rowIndex * 2 + column + 1, images.size)
                    PostImageView(post.postId, image, description, Modifier.weight(1f).aspectRatio(1f))
                }
                if (row.size == 1) Box(modifier = Modifier.weight(1f))
            }
        }
    }
}

@Composable
internal fun PostImageView(
    postId: String,
    image: PostImage,
    description: String,
    modifier: Modifier,
) {
    val images = LocalPostImages.current
    val decoding = LocalPhotoDecoding.current
    val path by produceState<String?>(null, postId, image.mediaId, images, decoding) {
        value = images?.let { withContext(decoding) { it.path(postId, image.mediaId) } }
    }
    val longest = with(LocalDensity.current) { SHOWN.dp.roundToPx() }
    val bitmap = rememberPhoto(path, longest)
    val shaped = modifier.clip(RoundedCornerShape(RADIUS.dp))
    bitmap?.let {
        Image(
            bitmap = it,
            contentDescription = description,
            contentScale = ContentScale.Crop,
            modifier = shaped,
        )
    } ?: Box(modifier = shaped.background(Palette.muted))
}

/** The images picked for the post being written, each with an X that takes it out. */
@Composable
fun PickedImages(
    paths: List<String>,
    onRemove: (String) -> Unit,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(GAP.dp)) {
        paths.forEach { path ->
            Box {
                val longest = with(LocalDensity.current) { THUMBNAIL.dp.roundToPx() * 2 }
                val bitmap = rememberPhoto(path, longest)
                val modifier = Modifier.size(THUMBNAIL.dp).clip(RoundedCornerShape(RADIUS.dp))
                bitmap?.let {
                    Image(bitmap = it, contentDescription = null, contentScale = ContentScale.Crop, modifier = modifier)
                } ?: Box(modifier = modifier.background(Palette.muted))
                IconButton(
                    onClick = { onRemove(path) },
                    modifier = Modifier.align(Alignment.TopEnd).size(REMOVE.dp),
                ) {
                    Icon(
                        Icons.Filled.Close,
                        contentDescription = stringResource(R.string.post_image_remove),
                        tint = Palette.fg,
                        modifier = Modifier.size(MARK.dp).background(Palette.surface, CircleShape),
                    )
                }
            }
        }
    }
}

/** About the widest a post's image is shown, in dp. */
private const val SHOWN = 480
private const val THUMBNAIL = 72
private const val REMOVE = 40
private const val MARK = 22
private const val RADIUS = 10
private const val GAP = 6

/** A tall or wide image alone is cropped to no more than this. */
private const val MIN_RATIO = 0.75f
private const val MAX_RATIO = 2f
