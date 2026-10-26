package samtak.spjall.conversation

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.Conversation
import samtak.spjall.core.ConversationState
import samtak.spjall.core.MuteFor
import samtak.spjall.core.Person
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.CancelButton
import samtak.spjall.ui.Palette
import samtak.spjall.ui.RoundButton
import samtak.spjall.ui.duration
import samtak.spjall.ui.shownName

/** The title opens the information screen (0055, 0095) while the conversation is open. */
internal fun Conversation.opensInfo() = state == ConversationState.ACTIVE || state == ConversationState.NEW

/** Asks before blocking `other` (0024). */
@Composable
internal fun BlockDialog(
    other: Person,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        text = { Text(stringResource(R.string.block_confirm, other.shownName())) },
        confirmButton = {
            // Drawn as the menu draws it (0054).
            TextButton(onClick = onConfirm, colors = ButtonDefaults.textButtonColors(contentColor = Palette.danger)) {
                Text(stringResource(R.string.block))
            }
        },
        dismissButton = { CancelButton(onClick = onDismiss) },
    )
}

/** Off, or one of the timers 0022 lists. */
@Composable
internal fun TimerDialog(
    current: UInt?,
    onPick: (UInt?) -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.disappearing_messages)) },
        text = {
            Column(modifier = Modifier.selectableGroup()) {
                (listOf(null) + TIMERS).forEach { seconds ->
                    Row(
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .selectable(selected = seconds == current, role = Role.RadioButton) { onPick(seconds) }
                                .padding(vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(selected = seconds == current, onClick = null)
                        Text(
                            text =
                                seconds?.let { stringResource(R.string.disappearing_option, duration(it)) }
                                    ?: stringResource(R.string.disappearing_off),
                            modifier = Modifier.padding(start = 16.dp),
                        )
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = { CancelButton(onClick = onDismiss) },
    )
}

/**
 * The three durations 0042 offers, from the information screen (0055) and from a long press on the list's row
 * (0043); the server sets the end by its own clock.
 */
@Composable
internal fun MuteDialog(
    onPick: (MuteFor) -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.mute)) },
        text = {
            Column {
                MUTES.forEach { (duration, label) ->
                    Text(
                        text = stringResource(label),
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .clickable(role = Role.Button) { onPick(duration) }
                                .padding(vertical = 12.dp),
                    )
                }
            }
        },
        confirmButton = {},
        dismissButton = { CancelButton(onClick = onDismiss) },
    )
}

/** Takes a photo with the system camera (0047); what it takes is sent. */
@Composable
internal fun CameraButton(actions: ConversationActions) {
    RoundButton(
        icon = AppIcons.Camera,
        description = stringResource(R.string.camera),
        onClick = actions::takePhoto,
        fill = Palette.muted,
        tint = Palette.fg,
        size = ATTACH.dp,
    )
}

/** Photo or file; the pickers are the system's. */
@Composable
internal fun AttachButton(actions: ConversationActions) {
    var open by rememberSaveable { mutableStateOf(false) }
    Box {
        RoundButton(
            icon = AppIcons.Plus,
            description = stringResource(R.string.attach),
            onClick = { open = true },
            fill = Palette.muted,
            tint = Palette.fg,
            size = ATTACH.dp,
        )
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(
                text = { Text(stringResource(R.string.photo)) },
                onClick = {
                    open = false
                    actions.attachPhoto()
                },
            )
            DropdownMenuItem(
                text = { Text(stringResource(R.string.file)) },
                onClick = {
                    open = false
                    actions.attachFile()
                },
            )
            DropdownMenuItem(
                text = { Text(stringResource(R.string.location)) },
                onClick = {
                    open = false
                    actions.attachLocation()
                },
            )
        }
    }
}

/** One hour, one day, seven days and thirty days, in seconds. */
private val TIMERS = listOf(3_600u, 86_400u, 604_800u, 2_592_000u)

private val MUTES =
    listOf(
        MuteFor.HOUR to R.string.mute_hour,
        MuteFor.EIGHT_HOURS to R.string.mute_eight_hours,
        MuteFor.ALWAYS to R.string.mute_always,
    )

private const val ATTACH = 38
