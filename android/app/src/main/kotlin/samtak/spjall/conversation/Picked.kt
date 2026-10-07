package samtak.spjall.conversation

import java.io.File

/**
 * A photo or file the person chose, not read yet. [size] is what the picker
 * says, when it says; [read] copies it to a file the caller deletes.
 */
class Picked(
    val mime: String,
    val size: Long?,
    val read: () -> File,
)

/** The largest photo or file the core sends (0023), 25 MB. */
const val MEDIA_LIMIT = 25L * 1024 * 1024
