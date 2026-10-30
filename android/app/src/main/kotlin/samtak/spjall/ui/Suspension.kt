package samtak.spjall.ui

import androidx.compose.runtime.compositionLocalOf

/** A hold on this account's writing (decision 0115): ends at [until] in epoch ms, or when a moderator lifts it. */
data class Suspension(
    val until: ULong?,
) {
    /** Whether the hold still stands at [now]: one whose end has passed is over, whatever the server last said. */
    fun standsAt(now: Long): Boolean = until == null || until > now.toULong()
}

/** The suspension in force for the screen being drawn; none when there is none, or in a screen test. */
val LocalSuspension = compositionLocalOf<Suspension?> { null }
