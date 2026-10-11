package samtak.spjall.conversation

import samtak.spjall.core.Content
import samtak.spjall.core.Item
import samtak.spjall.core.ItemStatus
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** One line of the timeline as the screen draws it. */
sealed interface Row {
    val key: String

    /** A centred time between messages (0045), keyed by the item it comes before. */
    data class Time(
        val ts: ULong,
        val before: Item,
    ) : Row {
        override val key = "time-${before.key()}"
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
        /** The end of its run: the next bubble does not continue it. */
        val last: Boolean = true,
    ) : Row {
        override val key = item.key()
    }
}

/**
 * The timeline's rows, oldest first: a [Row.Time] before the first item, a
 * new day, or a gap of an hour or more (0045), and messages from one sender
 * within 5 minutes of each other run together (decision 0022), the first of
 * a run marked [Row.Bubble.first] and the last [Row.Bubble.last].
 */
fun rows(
    items: List<Item>,
    zone: ZoneId = ZoneId.systemDefault(),
): List<Row> {
    val read = items.lastOrNull { it.own && it.seq != null && it.readBy > 0u }
    val rows = mutableListOf<Row>()
    var previous: Item? = null
    var before: Item? = null
    for (item in items) {
        // The timeline is in arrival order, so a message sent offline yesterday can
        // come among today's: its day differs from the one before it, and so does
        // the next one's, so each gets a line and no time shows under the wrong day.
        if (before == null || apart(before, item, zone)) {
            rows += Row.Time(item.ts, item)
            previous = null
        }
        before = item
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

/** What the small line under a bubble shows, in order. */
enum class MetaPart { EDITED, SENDING, TIME, READ }

/**
 * The line under a bubble: the edited marker, then a clock while sending
 * (0043) or the time when the bubble was tapped open (0045), then who read it.
 * The times otherwise go between messages.
 */
fun Row.Bubble.meta(open: Boolean = false): List<MetaPart> =
    listOfNotNull(
        MetaPart.EDITED.takeIf { item.edited },
        when {
            item.status == ItemStatus.PENDING -> MetaPart.SENDING
            open -> MetaPart.TIME
            else -> null
        },
        MetaPart.READ.takeIf { readBy != null },
    )

fun Item.isCard() = content is Content.Members || content is Content.Timer

private fun Item.key() = seq?.let { "s$it" } ?: envelopeId?.let { "e$it" } ?: "t$ts"

private fun Item.day(zone: ZoneId): LocalDate = Instant.ofEpochMilli(ts.toLong()).atZone(zone).toLocalDate()

/** A new day, or an hour or more either way: a time line goes between them (0045). */
private fun apart(
    before: Item,
    item: Item,
    zone: ZoneId,
): Boolean {
    val gap = if (item.ts >= before.ts) item.ts - before.ts else before.ts - item.ts
    return item.day(zone) != before.day(zone) || gap >= TIME_GAP_MS
}

private const val RUN_MS: ULong = 300_000uL
private const val TIME_GAP_MS: ULong = 3_600_000uL
