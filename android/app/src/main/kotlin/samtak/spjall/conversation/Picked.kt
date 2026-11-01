package samtak.spjall.conversation

import samtak.spjall.limits.Limits
import java.io.File

/**
 * A photo or file the person chose, not read yet. [size] and [name] are what
 * the picker says, when it says; [read] copies it to a file the caller deletes.
 */
class Picked(
    val mime: String,
    val size: Long?,
    val name: String? = null,
    val read: () -> File,
)

/** The largest photo or file the core sends (0023), 25 MB. */
const val MEDIA_LIMIT = Limits.MEDIA_BYTES
