package samtak.spjall.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.PointerInputScope
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.withContext
import samtak.spjall.brand.R
import samtak.spjall.media.LocalPhotoDecoding
import samtak.spjall.media.rememberPhoto
import kotlin.math.max
import kotlin.math.min

/**
 * The images at full screen on black, from [start]: a swipe moves between them, a pinch or a double tap zooms,
 * a zoomed image is panned by dragging and is back to fitted when the page changes. The close button and BACK end
 * it through [onDismiss].
 */
@Composable
fun ImageViewer(
    images: List<ViewerImage>,
    start: Int,
    onDismiss: () -> Unit,
) {
    if (images.isEmpty()) return
    val name = stringResource(R.string.image_viewer)
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        val pager = rememberPagerState(initialPage = start.coerceIn(0, images.lastIndex)) { images.size }
        var zoomed by remember { mutableStateOf(false) }
        Box(Modifier.fillMaxSize().background(Color.Black).semantics { contentDescription = name }) {
            HorizontalPager(
                state = pager,
                userScrollEnabled = !zoomed,
                key = { images[it].key },
                modifier = Modifier.fillMaxSize(),
            ) { page ->
                ViewerPage(images[page], active = pager.settledPage == page) { zoomed = it }
            }
            IconButton(
                onClick = onDismiss,
                modifier = Modifier.align(Alignment.TopEnd).windowInsetsPadding(WindowInsets.safeDrawing),
            ) {
                Icon(Icons.Filled.Close, contentDescription = stringResource(R.string.close), tint = Color.White)
            }
        }
    }
}

@Composable
private fun ViewerPage(
    image: ViewerImage,
    active: Boolean,
    onZoomed: (Boolean) -> Unit,
) {
    val decoding = LocalPhotoDecoding.current
    val path by produceState<String?>(null, image.key, decoding) {
        value = withContext(decoding) { image.path() }
    }
    BoxWithConstraints(Modifier.fillMaxSize().semantics { contentDescription = image.description }) {
        // Decoded at the screen's longest side, where the grid decodes at a card's width.
        val longest = max(constraints.maxWidth, constraints.maxHeight)
        val bitmap = rememberPhoto(path, longest)
        var scale by remember { mutableFloatStateOf(1f) }
        var offset by remember { mutableStateOf(Offset.Zero) }
        val photo = rememberUpdatedState(bitmap)

        // The fitted image's size at scale 1, the bound of how far a zoomed one may be dragged.
        fun fitted(area: IntSize): Pair<Float, Float> {
            val b = photo.value ?: return area.width.toFloat() to area.height.toFloat()
            val fit = min(area.width.toFloat() / b.width, area.height.toFloat() / b.height)
            return b.width * fit to b.height * fit
        }

        fun set(
            area: IntSize,
            newScale: Float,
            newOffset: Offset,
        ) {
            val (w, h) = fitted(area)
            val (limitX, limitY) = panLimit(w, h, area.width.toFloat(), area.height.toFloat(), newScale)
            scale = newScale
            offset = Offset(newOffset.x.coerceIn(-limitX, limitX), newOffset.y.coerceIn(-limitY, limitY))
        }
        LaunchedEffect(active) {
            if (!active) {
                scale = 1f
                offset = Offset.Zero
            }
        }
        LaunchedEffect(active, scale > 1f) { if (active) onZoomed(scale > 1f) }
        val zoomable =
            Modifier
                .fillMaxSize()
                .pointerInput(Unit) { pinchAndPan({ scale }, { offset }, ::set) }
                .pointerInput(Unit) {
                    detectTapGestures(
                        onDoubleTap = { tap ->
                            val centre = Offset(size.width / 2f, size.height / 2f)
                            if (scale > 1f) {
                                set(size, 1f, Offset.Zero)
                            } else {
                                set(size, DOUBLE_TAP_SCALE, (centre - tap) * (DOUBLE_TAP_SCALE - 1f))
                            }
                        },
                    )
                }.graphicsLayer(
                    scaleX = scale,
                    scaleY = scale,
                    translationX = offset.x,
                    translationY = offset.y,
                )
        bitmap?.let {
            Image(
                bitmap = it,
                contentDescription = null,
                contentScale = ContentScale.Fit,
                modifier = zoomable,
            )
        }
    }
}

/**
 * Two fingers zoom around where they are, and one finger pans once zoomed. A single finger on a fitted image is
 * left alone, so the pager can take the swipe.
 */
private suspend fun PointerInputScope.pinchAndPan(
    scale: () -> Float,
    offset: () -> Offset,
    apply: (IntSize, Float, Offset) -> Unit,
) {
    awaitEachGesture {
        awaitFirstDown(requireUnconsumed = false)
        do {
            val event = awaitPointerEvent(PointerEventPass.Main)
            if (event.changes.none { it.isConsumed } && (event.changes.size > 1 || scale() > 1f)) {
                val zoom = event.calculateZoom()
                val pan = event.calculatePan()
                val from = scale()
                val to = (from * zoom).coerceIn(1f, MAX_SCALE)
                val centre = Offset(size.width / 2f, size.height / 2f)
                val about = event.calculateCentroid(useCurrent = false) - centre
                // Keeps the point between the fingers where it was.
                apply(size, to, about * (1f - to / from) + offset() * (to / from) + pan)
                event.changes.forEach { if (it.positionChanged()) it.consume() }
            }
        } while (event.changes.any { it.pressed })
    }
}

/**
 * How far, in each direction, an image fitted to a [contentWidth] by [contentHeight] box inside an area of
 * [areaWidth] by [areaHeight] may be moved from the middle at [scale]: what the zoom made larger than the area,
 * halved, and nothing while it fits.
 */
fun panLimit(
    contentWidth: Float,
    contentHeight: Float,
    areaWidth: Float,
    areaHeight: Float,
    scale: Float,
): Pair<Float, Float> =
    max(0f, (contentWidth * scale - areaWidth) / 2f) to max(0f, (contentHeight * scale - areaHeight) / 2f)

private const val MAX_SCALE = 5f
private const val DOUBLE_TAP_SCALE = 3f
