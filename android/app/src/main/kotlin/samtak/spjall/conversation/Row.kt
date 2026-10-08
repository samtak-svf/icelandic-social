package samtak.spjall.conversation

import samtak.spjall.core.Content
import samtak.spjall.core.Item
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** One line of the timeline as the screen draws it. */
sealed interface Row {
    val key: String

    /** Where a new day starts. */
    data class Day(
        val date: LocalDate,
    ) : Row {
        override val key = "day-$date"
    }

    /** A system card: members or the disappearing timer changed. */
    data class Card(
        val item: Item,
    ) : Row {
        override val key = item.key()
    }

    data class Bubble(
        val item: Item,
        /** The first of a run from one sender: it shows the sender's name in a group. */
        val first: Boolean,
        /** Under the newest own message someone has read: how many have. */
        val readBy: UInt?,
        /** The end of its run: the time goes under it. */
        val last: Boolean = true,
    ) : Row {
        override val key = item.key()
    }
}

/**
 * The timeline's rows, oldest first: a [Row.Day] before each new day, and
 * messages from one sender within 5 minutes of each other run together
 * (decision 0022), the first of a run marked [Row.Bubble.first] and the
 * last [Row.Bubble.last].
 */
fun rows(
    items: List<Item>,
    zone: ZoneId = ZoneId.systemDefault(),
): List<Row> {
    val read = items.lastOrNull { it.own && it.seq != null && it.readBy > 0u }
    val rows = mutableListOf<Row>()
    var previous: Item? = null
    var day: LocalDate? = null
    for (item in items) {
        val date = Instant.ofEpochMilli(item.ts.toLong()).atZone(zone).toLocalDate()
        if (date != day) {
            rows += Row.Day(date)
            day = date
            previous = null
        }
        if (item.isCard()) {
            rows += Row.Card(item)
            previous = null
            continue
        }
        val runs =
            previous != null &&
                previous.sender.account == item.sender.account &&
                item.ts - previous.ts <= RUN_MS
        rows += Row.Bubble(item, first = !runs, readBy = if (item === read) item.readBy else null)
        previous = item
    }
    return rows.mapIndexed { i, row ->
        val next = rows.getOrNull(i + 1)
        if (row is Row.Bubble && next is Row.Bubble && !next.first) row.copy(last = false) else row
    }
}

fun Item.isCard() = content is Content.Members || content is Content.Timer

private fun Item.key() = seq?.let { "s$it" } ?: envelopeId?.let { "e$it" } ?: "t$ts"

private const val RUN_MS: ULong = 300_000uL
