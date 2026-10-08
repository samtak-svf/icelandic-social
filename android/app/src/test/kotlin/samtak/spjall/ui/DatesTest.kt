package samtak.spjall.ui

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.Locale

class DatesTest {
    private val zone = ZoneId.of("Atlantic/Reykjavik")

    // Thursday 8 October 2026, mid-afternoon.
    private val now = ZonedDateTime.of(2026, 10, 8, 14, 51, 0, 0, zone)

    private fun at(
        month: Int,
        day: Int,
        hour: Int = 9,
        minute: Int = 38,
        year: Int = 2026,
    ) = ZonedDateTime.of(year, month, day, hour, minute, 0, 0, zone)

    @Test
    fun timesAreOnA24HourClockWhateverTheDeviceLanguage() {
        val saved = Locale.getDefault()
        try {
            Locale.setDefault(Locale.US)
            assertEquals("09:38", Dates.time(at(10, 8)))
            assertEquals("21:05", Dates.time(at(10, 8, 21, 5)))
        } finally {
            Locale.setDefault(saved)
        }
    }

    @Test
    fun aRowStampIsTheTimeTodayThenYesterdayThenTheWeekdayThenTheDate() {
        assertEquals("09:38", Dates.stamp(at(10, 8), now, "Í gær"))
        assertEquals("í gær", Dates.stamp(at(10, 7, 23, 59), now, "Í gær"))
        assertEquals("mán", Dates.stamp(at(10, 5), now, "Í gær"))
        assertEquals("fös", Dates.stamp(at(10, 2), now, "Í gær"))
        assertEquals("30. ágú", Dates.stamp(at(8, 30), now, "Í gær"))
        assertEquals("2. okt. 2025", Dates.stamp(at(10, 2, year = 2025), now, "Í gær"))
    }

    @Test
    fun aClockAheadOfOursStillShowsATime() {
        assertEquals("15:10", Dates.stamp(at(10, 8, 15, 10), now, "Í gær"))
    }

    @Test
    fun aDayHeadingNamesTodayYesterdayTheWeekdayOrTheDate() {
        val today = LocalDate.of(2026, 10, 8)
        assertEquals("Í dag", Dates.day(today, today, "Í dag", "Í gær"))
        assertEquals("Í gær", Dates.day(today.minusDays(1), today, "Í dag", "Í gær"))
        assertEquals("mánudagur", Dates.day(LocalDate.of(2026, 10, 5), today, "Í dag", "Í gær"))
        assertEquals("30. ágúst", Dates.day(LocalDate.of(2026, 8, 30), today, "Í dag", "Í gær"))
        assertEquals("30. desember 2025", Dates.day(LocalDate.of(2025, 12, 30), today, "Í dag", "Í gær"))
    }

    @Test
    fun aDeviceDateCarriesItsYear() {
        assertEquals("2. okt. 2026", Dates.date(at(10, 2)))
        assertEquals("5. maí 2026", Dates.date(at(5, 5)))
    }

    @Test
    fun millisAreReadInTheGivenZone() {
        assertEquals(at(10, 8, 0, 30), Dates.at(1_791_419_400_000uL, zone))
    }
}
