package samtak.spjall.media

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlin.coroutines.CoroutineContext

/**
 * Where a composable decodes a photo: off the main thread in the app. A test provides
 * `EmptyCoroutineContext`, so the decode runs on the composition's own thread and ends with it;
 * under Robolectric's native graphics, a decode still running on another thread when a test ends
 * runs into the next test's setup and aborts the JVM.
 */
val LocalPhotoDecoding = staticCompositionLocalOf<CoroutineContext> { Dispatchers.IO }

/** The photo at [path], about [longest] pixels on its long side; null with no path and while it decodes. */
@Composable
fun rememberPhoto(
    path: String?,
    longest: Int,
): ImageBitmap? {
    val decoding = LocalPhotoDecoding.current
    val bitmap by produceState<ImageBitmap?>(null, path, longest, decoding) {
        value = path?.let { withContext(decoding) { decodePhoto(it, longest)?.asImageBitmap() } }
    }
    return bitmap
}
