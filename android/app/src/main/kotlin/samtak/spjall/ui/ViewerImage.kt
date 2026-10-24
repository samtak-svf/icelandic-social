package samtak.spjall.ui

/**
 * One image the viewer can show. [path] is where the file is now, null when it cannot be had; it may block, and is
 * called off the main thread. The viewer knows nothing of what the image belongs to, so a post's images and a
 * comment's (decision 0082) use it unchanged.
 */
class ViewerImage(
    val key: String,
    val description: String,
    val path: () -> String?,
)
