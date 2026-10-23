package samtak.spjall.social

import org.junit.Assert.assertEquals
import org.junit.Test

class RelativeTimeTest {
    private val now = 1_800_000_000_000L

    private fun agoOf(gone: Long) = ago(now - gone, now)

    @Test
    fun lessThanAMinuteIsNow() = assertEquals(Ago(AgoUnit.NOW, 0), agoOf(59_000))

    @Test
    fun minutesHoursDaysAndWeeksAreWhole() {
        assertEquals(Ago(AgoUnit.MINUTES, 5), agoOf(5 * 60_000L + 30_000))
        assertEquals(Ago(AgoUnit.HOURS, 2), agoOf(2 * 3_600_000L + 1))
        assertEquals(Ago(AgoUnit.DAYS, 3), agoOf(3 * 86_400_000L))
        assertEquals(Ago(AgoUnit.WEEKS, 2), agoOf(15 * 86_400_000L))
    }

    @Test
    fun anOldDateIsShownAsADate() = assertEquals(Ago(AgoUnit.DATE, 0), agoOf(60 * 86_400_000L))

    @Test
    fun aClockAheadOfTheServerIsNow() = assertEquals(Ago(AgoUnit.NOW, 0), ago(now + 5_000, now))
}
