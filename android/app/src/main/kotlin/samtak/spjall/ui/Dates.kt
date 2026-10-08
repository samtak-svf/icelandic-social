package samtak.spjall.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import samtak.spjall.brand.R
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Every date and time the app shows, in Icelandic whatever the device's
 * language: a 24-hour clock, "í gær", short weekdays and day-first dates.
 * The words for today and yesterday are brand strings and come in as
 * arguments, so this stays plain Kotlin and unit-testable.
 */
object Dates {
    val ICELANDIC: Locale = Locale.forLanguageTag("is")

    private val clock = DateTimeFormatter.ofPattern("HH:mm", ICELANDIC)
    private val weekday = DateTimeFormatter.ofPattern("EEE", ICELANDIC)
    private val weekdayLong = DateTimeFormatter.ofPattern("EEEE", ICELANDIC)
    private val dayMonth = DateTimeFormatter.ofPattern("d. MMM", ICELANDIC)
    private val dayMonthLong = DateTimeFormatter.ofPattern("d. MMMM", ICELANDIC)
    private val dayMonthYear = DateTimeFormatter.ofPattern("d. MMM yyyy", ICELANDIC)
    private val dayMonthYearLong = DateTimeFormatter.ofPattern("d. MMMM yyyy", ICELANDIC)

    /** "09:38". */
    fun time(at: ZonedDateTime): String = clock.format(at)

    /**
     * A conversation row's stamp: the time today, [yesterday], the weekday
     * within the week ("mán"), the day and month this year ("30. ágú"),
     * else with the year too.
     */
    fun stamp(
        at: ZonedDateTime,
        now: ZonedDateTime,
        yesterday: String,
    ): String {
        val day = at.toLocalDate()
        val today = now.toLocalDate()
        return when {
            day == today || day.isAfter(today) -> time(at)
            day == today.minusDays(1) -> yesterday.lowercase(ICELANDIC)
            day.isAfter(today.minusDays(WEEK)) -> bare(weekday.format(at))
            day.year == today.year -> bare(dayMonth.format(at))
            else -> dayMonthYear.format(at)
        }
    }

    /**
     * The line where a new day starts in a conversation: [today], [yesterday],
     * the weekday within the week ("mánudagur"), else the date ("30. ágúst").
     */
    fun day(
        date: LocalDate,
        today: LocalDate,
        todayWord: String,
        yesterdayWord: String,
    ): String =
        when {
            date == today -> todayWord
            date == today.minusDays(1) -> yesterdayWord
            date.isAfter(today.minusDays(WEEK)) && date.isBefore(today) -> weekdayLong.format(date)
            date.year == today.year -> dayMonthLong.format(date)
            else -> dayMonthYearLong.format(date)
        }

    /** A calendar date with its year: "2. okt. 2026". */
    fun date(at: ZonedDateTime): String = dayMonthYear.format(at)

    fun at(
        millis: ULong,
        zone: ZoneId = ZoneId.systemDefault(),
    ): ZonedDateTime = Instant.ofEpochMilli(millis.toLong()).atZone(zone)

    /** CLDR abbreviates with a full stop ("mán.", "ágú."); a list stamp drops it. */
    private fun bare(text: String) = text.removeSuffix(".")

    private const val WEEK = 7L
}

/** A conversation row's stamp for [millis]. */
@Composable
fun listStamp(millis: ULong): String {
    val at = Dates.at(millis)
    return Dates.stamp(at, ZonedDateTime.now(at.zone), stringResource(R.string.day_yesterday))
}

/** The clock time of [millis]. */
fun clockTime(millis: ULong): String = Dates.time(Dates.at(millis))

/** The date of [millis], with its year. */
fun calendarDate(millis: ULong): String = Dates.date(Dates.at(millis))

/** The heading of a day in a conversation. */
@Composable
fun dayHeading(date: LocalDate): String =
    Dates.day(
        date,
        LocalDate.now(),
        stringResource(R.string.day_today),
        stringResource(R.string.day_yesterday),
    )
