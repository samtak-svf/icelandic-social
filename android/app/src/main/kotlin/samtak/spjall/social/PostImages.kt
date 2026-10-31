package samtak.spjall.social

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.withContext
import samtak.spjall.brand.BrandTokens.Radius
import samtak.spjall.brand.R
import samtak.spjall.core.CoreException
import samtak.spjall.core.Post
import samtak.spjall.core.PostImage
import samtak.spjall.media.LocalPhotoDecoding
import samtak.spjall.media.rememberPhoto
import samtak.spjall.ui.ImageViewer
import samtak.spjall.ui.Palette
import samtak.spjall.ui.ViewerImage

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

/** Provides where a post's images come from to [content]; one the core cannot fetch now shows as a plain box. */
@Composable
internal fun WithPostImages(
    social: Social,
    content: @Composable () -> Unit,
) {
    val images =
        remember(social) {
            PostImages { postId, mediaId ->
                try {
                    social.postImage(postId, mediaId)
                } catch (_: CoreException) {
                    null
                }
            }
        }
    CompositionLocalProvider(LocalPostImages provides images, content = content)
}

/** A post's images under its text: one at its own shape, more two to a row as squares. */
@Composable
fun PostImageGrid(post: Post) {
    val images = post.images
    if (images.isEmpty()) return
    // Several images are told apart for TalkBack (#355): "Mynd 2 af 3".
    val descriptions =
        images.indices.map { index ->
            if (images.size == 1) {
                stringResource(R.string.post_image_alt)
            } else {
                stringResource(R.string.post_image_alt_numbered, index + 1, images.size)
            }
        }
    // The viewer opens on the image that was tapped (#119), with all of the post's.
    var viewing by rememberSaveable(post.postId) { mutableStateOf<Int?>(null) }
    val source = LocalPostImages.current
    viewing?.let { start ->
        val viewable =
            images.mapIndexed { index, image ->
                ViewerImage(image.mediaId, descriptions[index]) { source?.path(post.postId, image.mediaId) }
            }
        ImageViewer(viewable, start) { viewing = null }
    }
    val single = images.singleOrNull()
    if (single != null) {
        val ratio = if (single.height > 0u) single.width.toFloat() / single.height.toFloat() else 1f
        PostImageView(
            post.postId,
            single,
            descriptions[0],
            Modifier.fillMaxWidth().aspectRatio(ratio.coerceIn(MIN_RATIO, MAX_RATIO)),
        ) { viewing = 0 }
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(GAP.dp)) {
        images.chunked(2).forEachIndexed { rowIndex, row ->
            Row(horizontalArrangement = Arrangement.spacedBy(GAP.dp)) {
                row.forEachIndexed { column, image ->
                    val index = rowIndex * 2 + column
                    PostImageView(post.postId, image, descriptions[index], Modifier.weight(1f).aspectRatio(1f)) {
                        viewing = index
                    }
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
    onClick: (() -> Unit)? = null,
) {
    val images = LocalPostImages.current
    val decoding = LocalPhotoDecoding.current
    val path by produceState<String?>(null, postId, image.mediaId, images, decoding) {
        value = images?.let { withContext(decoding) { it.path(postId, image.mediaId) } }
    }
    val longest = with(LocalDensity.current) { SHOWN.dp.roundToPx() }
    val bitmap = rememberPhoto(path, longest)
    val shaped = modifier.clip(RoundedCornerShape(Radius.THUMBNAIL_DP.dp))
    bitmap?.let {
        Image(
            bitmap = it,
            contentDescription = description,
            contentScale = ContentScale.Crop,
            modifier =
                if (onClick == null) {
                    shaped
                } else {
                    shaped.clickable(onClickLabel = stringResource(R.string.image_viewer), onClick = onClick)
                },
        )
    } ?: Box(modifier = shaped.background(Palette.muted))
}

/** Why an image did not go with the post or comment, in the words of the brand. */
@Composable
internal fun CommunityViewModel.ImageNotice.text(): String =
    stringResource(
        when (this) {
            CommunityViewModel.ImageNotice.TooMany -> R.string.post_images_too_many
            CommunityViewModel.ImageNotice.TooLarge -> R.string.post_image_too_large
            CommunityViewModel.ImageNotice.Invalid -> R.string.post_image_failed
        },
    )

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
                val modifier = Modifier.size(THUMBNAIL.dp).clip(RoundedCornerShape(Radius.THUMBNAIL_DP.dp))
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
private const val GAP = 6

/** A tall or wide image alone is cropped to no more than this. */
internal const val MIN_RATIO = 0.75f
internal const val MAX_RATIO = 2f
