package samtak.spjall.conversation

/** A file to open in another app. */
data class Opened(
    val path: String,
    val mime: String,
    val name: String?,
)
