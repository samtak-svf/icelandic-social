package samtak.spjall.conversation

import org.junit.Assert.assertEquals
import org.junit.Test
import samtak.spjall.core.Content
import samtak.spjall.core.ItemStatus
import samtak.spjall.socket.item
import samtak.spjall.socket.person
import java.time.LocalDate
import java.time.ZoneOffset

class RowsTest {
    private val day = 1_700_000_000_000uL // 2023-11-14 22:13 UTC
    private val minute = 60_000uL
    private val anna = person("a2", "Anna")
    private val me = person("a1", "Jón")

    private fun shape(rows: List<Row>) =
        rows.map {
            when (it) {
                is Row.Day -> "day ${it.date}"
                is Row.Card -> "card ${it.item.seq}"
                is Row.Bubble ->
                    listOfNotNull(
                        "${it.item.seq}",
                        "first".takeIf { _ -> it.first },
                        "last".takeIf { _ -> it.last },
                        it.readBy?.let { n -> "read $n" },
                    ).joinToString(" ")
            }
        }

    @Test
    fun runsFromOneSenderWithinFiveMinutesGoTogether() {
        val rows =
            rows(
                listOf(
                    item(1u, sender = anna, ts = day),
                    item(2u, sender = anna, ts = day + 5uL * minute),
                    item(3u, sender = anna, ts = day + 11uL * minute),
                    item(4u, sender = me, own = true, ts = day + 12uL * minute),
                ),
                ZoneOffset.UTC,
            )
        assertEquals(listOf("day 2023-11-14", "1 first", "2 last", "3 first last", "4 first last"), shape(rows))
    }

    @Test
    fun aNewDayAndACardBreakARun() {
        val rows =
            rows(
                listOf(
                    item(1u, ts = day),
                    item(2u, ts = day + 1uL * minute, content = Content.Timer(3_600u)),
                    item(3u, ts = day + 2uL * minute),
                    item(4u, ts = day + 120uL * minute),
                ),
                ZoneOffset.UTC,
            )
        assertEquals(
            listOf("day 2023-11-14", "1 first last", "card 2", "3 first last", "day 2023-11-15", "4 first last"),
            shape(rows),
        )
        assertEquals(LocalDate.of(2023, 11, 15), (rows[4] as Row.Day).date)
    }

    @Test
    fun theReadLineSitsUnderTheNewestOwnMessageSomeoneRead() {
        val rows =
            rows(
                listOf(
                    item(1u, sender = me, own = true, ts = day, readBy = 2u),
                    item(2u, sender = me, own = true, ts = day, readBy = 1u),
                    item(3u, sender = me, own = true, ts = day),
                    item(null, sender = me, own = true, ts = day),
                ),
                ZoneOffset.UTC,
            )
        assertEquals(listOf("day 2023-11-14", "1 first", "2 read 1", "3", "null last"), shape(rows))
    }

    @Test
    fun keysAreUniqueAndStable() {
        val items = listOf(item(1u), item(2u), item(null, ts = day + 9uL))
        val keys = rows(items, ZoneOffset.UTC).map { it.key }
        assertEquals(keys.toSet().size, keys.size)
        assertEquals(keys, rows(items, ZoneOffset.UTC).map { it.key })
    }

    @Test
    fun aPendingMessageShowsTheClockInPlaceOfTheTime() {
        val pending = item(null, sender = me, own = true, ts = day, status = ItemStatus.PENDING)
        assertEquals(listOf(MetaPart.SENDING), Row.Bubble(pending, first = true, readBy = null).meta())
        val edited = Row.Bubble(pending.copy(edited = true), first = true, readBy = null, last = false)
        assertEquals(listOf(MetaPart.EDITED, MetaPart.SENDING), edited.meta())
        val sent = item(1u, sender = me, own = true, ts = day)
        assertEquals(listOf(MetaPart.TIME, MetaPart.READ), Row.Bubble(sent, first = true, readBy = 1u).meta())
        assertEquals(emptyList<MetaPart>(), Row.Bubble(sent, first = true, readBy = null, last = false).meta())
    }
}
