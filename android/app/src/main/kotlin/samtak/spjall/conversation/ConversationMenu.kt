package samtak.spjall.conversation

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.Palette
import samtak.spjall.ui.RoundButton
import samtak.spjall.ui.duration
import samtak.spjall.ui.shownName

/** The conversation's menu: the disappearing timer, and block in a 1:1 (0022, 0024). */
@Composable
internal fun ConversationMenu(
    conversation: Conversation,
    actions: ConversationActions,
) {
    if (conversation.state != ConversationState.ACTIVE && conversation.state != ConversationState.NEW) return
    var open by rememberSaveable { mutableStateOf(false) }
    var timing by rememberSaveable { mutableStateOf(false) }
    var blocking by rememberSaveable { mutableStateOf(false) }
    val other = conversation.members.singleOrNull()
    Box {
        IconButton(onClick = { open = true }) {
            Icon(AppIcons.Menu, contentDescription = stringResource(R.string.more_options), tint = Palette.fg)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(
                text = { Text(stringResource(R.string.disappearing_messages)) },
                onClick = {
                    open = false
                    timing = true
                },
            )
            if (other != null) {
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.block)) },
                    onClick = {
                        open = false
                        blocking = true
                    },
                )
            }
        }
    }
    if (timing) {
        TimerDialog(
            current = conversation.timer,
            onPick = {
                timing = false
                if (it != conversation.timer) actions.timer(it)
            },
            onDismiss = { timing = false },
        )
    }
    if (blocking && other != null) {
        AlertDialog(
            onDismissRequest = { blocking = false },
            text = { Text(stringResource(R.string.block_confirm, other.shownName())) },
            confirmButton = {
                TextButton(onClick = {
                    blocking = false
                    actions.block()
                }) { Text(stringResource(R.string.block)) }
            },
            dismissButton = { TextButton(onClick = { blocking = false }) { Text(stringResource(R.string.cancel)) } },
        )
    }
}

/** Off, or one of the timers 0022 lists. */
@Composable
private fun TimerDialog(
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
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
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
        }
    }
}

/** One hour, one day, seven days and thirty days, in seconds. */
private val TIMERS = listOf(3_600u, 86_400u, 604_800u, 2_592_000u)

private const val ATTACH = 38
