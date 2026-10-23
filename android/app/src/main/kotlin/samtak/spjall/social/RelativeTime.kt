package samtak.spjall.social

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import samtak.spjall.brand.R
import samtak.spjall.ui.calendarDate

/** How long ago something was, in the unit a short label uses (0080). */
internal data class Ago(
    val unit: AgoUnit,
    val count: Long,
)

internal enum class AgoUnit { NOW, MINUTES, HOURS, DAYS, WEEKS, DATE }

private const val MINUTE_MS = 60_000L
private const val HOUR_MS = 60 * MINUTE_MS
private const val DAY_MS = 24 * HOUR_MS
private const val WEEK_MS = 7 * DAY_MS
private const val WEEKS_SHOWN = 5

/** [millis] seen from [now]: less than a minute is now, then whole minutes, hours, days and weeks, then a date. */
internal fun ago(
    millis: Long,
    now: Long,
): Ago {
    val gone = (now - millis).coerceAtLeast(0)
    return when {
        gone < MINUTE_MS -> Ago(AgoUnit.NOW, 0)
        gone < HOUR_MS -> Ago(AgoUnit.MINUTES, gone / MINUTE_MS)
        gone < DAY_MS -> Ago(AgoUnit.HOURS, gone / HOUR_MS)
        gone < WEEK_MS -> Ago(AgoUnit.DAYS, gone / DAY_MS)
        gone < WEEKS_SHOWN * WEEK_MS -> Ago(AgoUnit.WEEKS, gone / WEEK_MS)
        else -> Ago(AgoUnit.DATE, 0)
    }
}

/** The short relative label of [millis] on a card, a comment and a hub row: "Núna", "5 mín.", "2 klst.", "3 d.". */
@Composable
internal fun agoText(
    millis: ULong,
    now: Long = System.currentTimeMillis(),
): String {
    val ago = ago(millis.toLong(), now)
    return when (ago.unit) {
        AgoUnit.NOW -> stringResource(R.string.time_now)
        AgoUnit.MINUTES -> stringResource(R.string.time_minutes, ago.count)
        AgoUnit.HOURS -> stringResource(R.string.time_hours, ago.count)
        AgoUnit.DAYS -> stringResource(R.string.time_days, ago.count)
        AgoUnit.WEEKS -> stringResource(R.string.time_weeks, ago.count)
        AgoUnit.DATE -> calendarDate(millis)
    }
}
