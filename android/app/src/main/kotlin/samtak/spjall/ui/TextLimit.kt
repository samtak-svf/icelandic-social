package samtak.spjall.ui

/**
 * A text's length as the server counts it: code points (decision 0123). `String.length` counts
 * UTF-16 units, so it would stop a text of emoji at half the limit.
 */
fun String.textLength(): Int = codePointCount(0, length)

/** Whether the server takes this text at [limit]. */
fun String.fitsIn(limit: Int): Boolean = textLength() <= limit

/** What is kept of this text at [limit] code points; never half a character. */
fun String.clippedTo(limit: Int): String = if (fitsIn(limit)) this else substring(0, offsetByCodePoints(0, limit))
