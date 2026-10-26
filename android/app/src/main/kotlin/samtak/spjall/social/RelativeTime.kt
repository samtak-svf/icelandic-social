package samtak.spjall.social

import androidx.annotation.StringRes
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
private const val WEEKS_SHOWN = 4

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

/** The brand string of a unit's label, null for a date, which is written out (api/presentation.vectors.json). */
@StringRes
internal fun AgoUnit.label(): Int? =
    when (this) {
        AgoUnit.NOW -> R.string.time_now
        AgoUnit.MINUTES -> R.string.time_minutes
        AgoUnit.HOURS -> R.string.time_hours
        AgoUnit.DAYS -> R.string.time_days
        AgoUnit.WEEKS -> R.string.time_weeks
        AgoUnit.DATE -> null
    }

/** The short relative label of [millis] on a card, a comment and a hub row: "Núna", "5 mín.", "2 klst.", "3 d.". */
@Composable
internal fun agoText(
    millis: ULong,
    now: Long = System.currentTimeMillis(),
): String {
    val ago = ago(millis.toLong(), now)
    val label = ago.unit.label() ?: return calendarDate(millis)
    return if (ago.unit == AgoUnit.NOW) stringResource(label) else stringResource(label, ago.count)
}
