package samtak.spjall.conversation

import org.junit.Assert.assertEquals
import org.junit.Test
import samtak.spjall.core.Content
import samtak.spjall.core.ItemStatus
import samtak.spjall.socket.item
import samtak.spjall.socket.person
import java.time.ZoneOffset

class RowsTest {
    private val day = 1_700_000_000_000uL // 2023-11-14 22:13 UTC
    private val minute = 60_000uL
    private val anna = person("a2", "Anna")
    private val me = person("a1", "Jón")

    private fun shape(rows: List<Row>) =
        rows.map {
            when (it) {
                is Row.Time -> "time ${(it.ts.toLong() - day.toLong()) / minute.toLong()}"
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
        assertEquals(listOf("time 0", "1 first", "2 last", "3 first last", "4 first last"), shape(rows))
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
            listOf("time 0", "1 first last", "card 2", "3 first last", "time 120", "4 first last"),
            shape(rows),
        )
    }

    /** A group named or unnamed is a card too, and breaks the run around it (0078). */
    @Test
    fun aNameChangeIsACard() {
        val rows =
            rows(
                listOf(
                    item(1u, ts = day),
                    item(2u, ts = day + 1uL * minute, content = Content.Name("Fjölskyldan")),
                    item(3u, ts = day + 2uL * minute, content = Content.Name(null)),
                    item(4u, ts = day + 3uL * minute),
                ),
                ZoneOffset.UTC,
            )
        assertEquals(
            listOf("time 0", "1 first last", "card 2", "card 3", "4 first last"),
            shape(rows),
        )
    }

    /** A group photo set or removed is a card too (0094). */
    @Test
    fun aPhotoChangeIsACard() {
        val rows =
            rows(
                listOf(
                    item(1u, ts = day),
                    item(2u, ts = day + 1uL * minute, content = Content.Photo(true)),
                    item(3u, ts = day + 2uL * minute, content = Content.Photo(false)),
                    item(4u, ts = day + 3uL * minute),
                ),
                ZoneOffset.UTC,
            )
        assertEquals(
            listOf("time 0", "1 first last", "card 2", "card 3", "4 first last"),
            shape(rows),
        )
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
        assertEquals(listOf("time 0", "1 first", "2 read 1", "3", "null last"), shape(rows))
    }

    @Test
    fun keysAreUniqueAndStable() {
        val items = listOf(item(1u), item(2u), item(null, ts = day + 9uL))
        val keys = rows(items, ZoneOffset.UTC).map { it.key }
        assertEquals(keys.toSet().size, keys.size)
        assertEquals(keys, rows(items, ZoneOffset.UTC).map { it.key })
    }

    @Test
    fun serverTimesDrawTheLines() {
        // 0048: the sender's clock was two hours behind; the server's was not.
        val skew = 120uL * minute
        val rows =
            rows(
                listOf(
                    item(1u, ts = day - skew, receivedAt = day),
                    item(2u, ts = day + 1uL * minute - skew, receivedAt = day + 1uL * minute),
                    item(3u, ts = day + 61uL * minute - skew, receivedAt = day + 61uL * minute),
                ),
                ZoneOffset.UTC,
            )
        assertEquals(listOf("time 0", "1 first", "2 last", "time 61", "3 first last"), shape(rows))
    }

    @Test
    fun aLateSenderClockDrawsNoLine() {
        // 0045 drew a line for it naming an earlier time; 0048 withdrew that.
        val rows =
            rows(
                listOf(
                    item(1u, ts = day, receivedAt = day),
                    item(2u, ts = day + 120uL * minute, receivedAt = day + 120uL * minute),
                    item(3u, ts = day + 1uL * minute, receivedAt = day + 121uL * minute),
                    item(4u, ts = day + 125uL * minute, receivedAt = day + 125uL * minute),
                ),
                ZoneOffset.UTC,
            )
        assertEquals(
            listOf("time 0", "1 first last", "time 120", "2 first", "3", "4 last"),
            shape(rows),
        )
    }

    @Test
    fun oldRowsFallBackToTheSendersClockButNeverGoBack() {
        val rows =
            rows(
                listOf(
                    item(1u, ts = day),
                    item(2u, ts = day + 120uL * minute),
                    item(3u, ts = day + 1uL * minute),
                    item(4u, ts = day + 122uL * minute, receivedAt = day + 122uL * minute),
                ),
                ZoneOffset.UTC,
            )
        assertEquals(
            listOf("time 0", "1 first last", "time 120", "2 first", "3", "4 last"),
            shape(rows),
        )
    }

    @Test
    fun aPendingMessageWithASkewedClockAddsNoLine() {
        val rows =
            rows(
                listOf(
                    item(1u, sender = anna, ts = day, receivedAt = day + 120uL * minute),
                    item(null, sender = me, own = true, ts = day + 1uL * minute, status = ItemStatus.PENDING),
                ),
                ZoneOffset.UTC,
            )
        assertEquals(listOf("time 120", "1 first last", "null first last"), shape(rows))
    }

    @Test
    fun aGapOfAnHourOrMoreGetsALineAndLessDoesNot() {
        val early = day - 200uL * minute // 18:53, so the day stays the same
        val rows =
            rows(
                listOf(
                    item(1u, sender = anna, ts = early),
                    item(2u, sender = anna, ts = early + 59uL * minute),
                    item(3u, sender = anna, ts = early + 119uL * minute),
                    // Before 0048 a row could say an earlier time; it no longer goes back.
                    item(4u, sender = anna, ts = early + 59uL * minute),
                ),
                ZoneOffset.UTC,
            )
        assertEquals(
            listOf(
                "time -200",
                "1 first last",
                "2 first last",
                "time -81",
                "3 first",
                "4 last",
            ),
            shape(rows),
        )
    }

    @Test
    fun theMetaLineShowsATimeOnlyWhenOpen() {
        val pending = item(null, sender = me, own = true, ts = day, status = ItemStatus.PENDING)
        assertEquals(listOf(MetaPart.SENDING), Row.Bubble(pending, first = true, readBy = null).meta())
        val edited = Row.Bubble(pending.copy(edited = true), first = true, readBy = null, last = false)
        assertEquals(listOf(MetaPart.EDITED, MetaPart.SENDING), edited.meta())
        val sent = item(1u, sender = me, own = true, ts = day)
        // 0045: no time under a bubble unless it was tapped open.
        assertEquals(listOf(MetaPart.READ), Row.Bubble(sent, first = true, readBy = 1u).meta())
        assertEquals(emptyList<MetaPart>(), Row.Bubble(sent, first = true, readBy = null).meta())
        assertEquals(listOf(MetaPart.TIME), Row.Bubble(sent, first = true, readBy = null).meta(open = true))
    }

    /** A group's read state is faces (0125), so the meta line never carries the word or the count. */
    @Test
    fun aGroupsMetaLineHasNoReadPart() {
        val sent = item(1u, sender = me, own = true, ts = day)
        val row = Row.Bubble(sent, first = true, readBy = 2u)
        assertEquals(emptyList<MetaPart>(), row.meta(group = true))
        assertEquals(listOf(MetaPart.READ), row.meta(group = false))
    }
}
