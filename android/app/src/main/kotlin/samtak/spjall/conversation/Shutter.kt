package samtak.spjall.conversation

import android.content.ActivityNotFoundException

/**
 * The camera button's way to the camera app (#323). The manifest declares the camera permission for the
 * link scanner, and once it is declared the platform refuses the capture intent until it is granted, so
 * the button asks first and opens the camera only once the person has said yes.
 */
internal class Shutter(
    private val allowed: () -> Boolean,
    private val ask: () -> Unit,
    private val open: () -> Unit,
    private val denied: () -> Unit,
) {
    fun press() = if (allowed()) shoot() else ask()

    fun answered(granted: Boolean) = if (granted) shoot() else denied()

    private fun shoot() {
        try {
            open()
        } catch (_: ActivityNotFoundException) {
            // A phone with no camera app has nothing to open; the button then does nothing.
        } catch (_: SecurityException) {
            // Revoked between the check and the launch.
            denied()
        }
    }
}
