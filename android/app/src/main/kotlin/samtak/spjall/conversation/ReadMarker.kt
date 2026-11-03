package samtak.spjall.conversation

import samtak.spjall.core.Item

/**
 * Marks a conversation read up to the newest item a person has seen. Read means seen (#554): while the
 * screen is not [shown], a timeline that arrives is loaded but marks nothing, so the sender is not told
 * otherwise. A mark only moves forward, and [mark] runs once per new newest item.
 */
class ReadMarker(
    private val mark: suspend (ULong) -> Unit,
) {
    /** Whether the screen is in front of the person: set on `ON_START`, cleared on `ON_STOP`. */
    var shown = false

    private var marked: ULong? = null

    /** Marks everything up to the newest of [items] read, when the screen is shown and that moved on. */
    suspend fun read(items: List<Item>) {
        val newest = items.takeIf { shown }?.mapNotNull { it.seq }?.maxOrNull() ?: return
        if (marked?.let { newest <= it } == true) return
        mark(newest)
        marked = newest
    }
}
