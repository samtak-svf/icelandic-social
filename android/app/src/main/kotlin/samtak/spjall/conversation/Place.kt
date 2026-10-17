package samtak.spjall.conversation

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Build
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Place
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat
import androidx.core.os.CancellationSignal
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import samtak.spjall.brand.R
import samtak.spjall.core.Content
import samtak.spjall.core.PlaceLinks
import samtak.spjall.core.placeLinks
import samtak.spjall.ui.CancelButton
import samtak.spjall.ui.Type
import kotlin.coroutines.resume
import kotlin.math.roundToInt

/** A place the phone found, in WGS 84 microdegrees, as the envelope carries it (0059). */
data class Fix(
    val latE6: Int,
    val lonE6: Int,
    /** The fix's radius in metres, when the system gave one. */
    val accuracy: UInt?,
)

/**
 * The phone's place now (0059), from the system's own location service: minSdk 26 has
 * LocationManagerCompat, so no Play services. Asked only when the person chooses to send it,
 * and never kept.
 */
class Locator(
    private val context: Context,
) {
    fun allowed(): Boolean =
        PERMISSIONS.any { ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED }

    /** A fresh fix, or null when none comes within [FIX_TIMEOUT_MS]; a last known place is never sent. */
    @SuppressLint("MissingPermission") // Asked only after allowed() or the system's yes.
    suspend fun current(): Fix? {
        val manager = context.getSystemService(LocationManager::class.java)
        val provider = manager?.takeIf { allowed() }?.let(::provider) ?: return null
        return withTimeoutOrNull(FIX_TIMEOUT_MS) {
            suspendCancellableCoroutine { done ->
                val signal = CancellationSignal()
                done.invokeOnCancellation { signal.cancel() }
                LocationManagerCompat.getCurrentLocation(
                    manager,
                    provider,
                    signal,
                    ContextCompat.getMainExecutor(context),
                ) { location -> done.resume(location?.fix()) }
            }
        }
    }

    /** The fused provider where there is one, else satellites with a precise grant, else the network. */
    private fun provider(manager: LocationManager): String? {
        val precise =
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
                PackageManager.PERMISSION_GRANTED
        val wanted =
            listOfNotNull(
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) LocationManager.FUSED_PROVIDER else null,
                if (precise) LocationManager.GPS_PROVIDER else null,
                LocationManager.NETWORK_PROVIDER,
            )
        return wanted.firstOrNull { it in manager.allProviders && manager.isProviderEnabled(it) }
    }

    companion object {
        /** Coarse is enough to send a place; the person may grant only that. */
        val PERMISSIONS = arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)

        const val FIX_TIMEOUT_MS = 30_000L
    }
}

private fun Location.fix() =
    Fix(
        latE6 = (latitude * MICRO).roundToInt(),
        lonE6 = (longitude * MICRO).roundToInt(),
        accuracy = if (hasAccuracy()) accuracy.roundToInt().coerceAtLeast(0).toUInt() else null,
    )

private const val MICRO = 1_000_000.0

/**
 * The core's links and numbers for a place. A JVM test has no native core, so a test provides
 * its own, as [samtak.spjall.media.LocalPhotoDecoding] does for decoding.
 */
val LocalPlaceLinks = staticCompositionLocalOf<(Int, Int) -> PlaceLinks> { ::placeLinks }

/** "64,14196° N, 21,92657° V": the hemisphere is the brand's word, not a sign. */
@Composable
internal fun coordinates(links: PlaceLinks): String =
    stringResource(
        R.string.location_coordinates,
        stringResource(if (links.north) R.string.location_north else R.string.location_south, links.latitude),
        stringResource(if (links.east) R.string.location_east else R.string.location_west, links.longitude),
    )

/**
 * A sent place (0059): a pin, the heading, the coordinates and the accuracy, with no map and no
 * address. A tap offers map.is and the map app; outside Iceland, where map.is shows nothing, it
 * opens the map app at once. A long press is the bubble's own, as on a text's links.
 */
@Composable
internal fun LocationCard(
    content: Content.Location,
    foreground: Color,
    actions: ConversationActions,
    onLongPress: () -> Unit,
) {
    val links = LocalPlaceLinks.current(content.latE6, content.lonE6)
    var choosing by remember { mutableStateOf(false) }
    val haptic = LocalHapticFeedback.current
    val longPress by rememberUpdatedState(onLongPress)
    Box {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier =
                Modifier.pointerInput(links) {
                    detectTapGestures(
                        onLongPress = {
                            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                            longPress()
                        },
                        onTap = { if (links.mapIs == null) actions.openPlace(links.geo) else choosing = true },
                    )
                },
        ) {
            Icon(Icons.Filled.Place, contentDescription = null, tint = foreground)
            Column {
                Text(text = stringResource(R.string.location), style = Type.bubble, color = foreground)
                Text(text = coordinates(links), style = MaterialTheme.typography.bodySmall, color = foreground)
                content.accuracy?.let {
                    Text(
                        text = stringResource(R.string.location_accuracy, it.toInt()),
                        style = MaterialTheme.typography.bodySmall,
                        color = foreground,
                    )
                }
            }
        }
        DropdownMenu(expanded = choosing, onDismissRequest = { choosing = false }) {
            placeChoices(links).forEach { (label, uri) ->
                DropdownMenuItem(
                    text = { Text(stringResource(label)) },
                    onClick = {
                        choosing = false
                        actions.openPlace(uri)
                    },
                )
            }
        }
    }
}

/** map.is first when it has the place, then the map app. */
private fun placeChoices(links: PlaceLinks): List<Pair<Int, String>> =
    listOfNotNull(
        links.mapIs?.let { R.string.location_open_map_is to it },
        R.string.location_open_maps to links.geo,
    )

/** The same choices as TalkBack actions, as the bubble speaks for the card. */
@Composable
internal fun placeActions(
    content: Content?,
    actions: ConversationActions,
): List<CustomAccessibilityAction> {
    if (content !is Content.Location) return emptyList()
    val links = LocalPlaceLinks.current(content.latE6, content.lonE6)
    return placeChoices(links).map { (label, uri) ->
        CustomAccessibilityAction(stringResource(label)) {
            actions.openPlace(uri)
            true
        }
    }
}

/**
 * While the phone looks for its place, and then the question before it is sent: the person sees
 * the coordinates and the accuracy and chooses (0059).
 */
@Composable
internal fun LocatingDialog(
    locating: ConversationViewModel.Locating,
    actions: ConversationActions,
) {
    when (locating) {
        ConversationViewModel.Locating.Finding ->
            AlertDialog(
                onDismissRequest = actions::cancelLocation,
                text = {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        CircularProgressIndicator(modifier = Modifier.size(24.dp))
                        Text(stringResource(R.string.location_finding))
                    }
                },
                confirmButton = {},
                dismissButton = { CancelButton(onClick = actions::cancelLocation) },
            )
        is ConversationViewModel.Locating.Found -> {
            val fix = locating.fix
            val links = LocalPlaceLinks.current(fix.latE6, fix.lonE6)
            AlertDialog(
                onDismissRequest = actions::cancelLocation,
                title = { Text(stringResource(R.string.location_send_title)) },
                text = {
                    Column {
                        Text(coordinates(links))
                        fix.accuracy?.let { Text(stringResource(R.string.location_accuracy, it.toInt())) }
                    }
                },
                confirmButton = { TextButton(onClick = actions::sendLocation) { Text(stringResource(R.string.send)) } },
                dismissButton = { CancelButton(onClick = actions::cancelLocation) },
            )
        }
    }
}
