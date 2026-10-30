package samtak.spjall.ui

import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.staticCompositionLocalOf

/** A hold on this account's writing (decision 0115): ends at [until] in epoch ms, or when a moderator lifts it. */
data class Suspension(
    val until: ULong?,
) {
    /** Whether the hold still stands at [now]: one whose end has passed is over, whatever the server last said. */
    fun standsAt(now: Long): Boolean = until == null || until > now.toULong()
}

/** The suspension in force for the screen being drawn; none when there is none, or in a screen test. */
val LocalSuspension = compositionLocalOf<Suspension?> { null }

/**
 * Reads the account's suspension again. A refused write calls it, so a suspension that began while the screen was
 * open shows its notice and its end at once, not at the next return to the app; nothing in a screen test.
 */
val LocalSuspensionRefresh = staticCompositionLocalOf<() -> Unit> { {} }
