package samtak.spjall.conversation

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.Conversation
import samtak.spjall.core.ConversationState
import samtak.spjall.core.Mute
import samtak.spjall.core.MuteFor
import samtak.spjall.core.Person
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.Avatar
import samtak.spjall.ui.NameWithMark
import samtak.spjall.ui.Palette
import samtak.spjall.ui.RoundButton
import samtak.spjall.ui.SectionLabel
import samtak.spjall.ui.duration
import samtak.spjall.ui.shownName

/** The menu and the information sheet are offered while the conversation is open. */
internal fun Conversation.hasMenu() = state == ConversationState.ACTIVE || state == ConversationState.NEW

/**
 * The conversation's menu: its information, the disappearing timer, mute
 * (0042), and block in a 1:1 (0022, 0024). The information sheet (0043)
 * offers the same choices under who is here; [info] is whether it is open, so
 * a tap on the title opens it too.
 */
@Composable
internal fun ConversationMenu(
    conversation: Conversation,
    actions: ConversationActions,
    info: Boolean,
    onInfo: (Boolean) -> Unit,
) {
    if (!conversation.hasMenu()) return
    var timing by rememberSaveable { mutableStateOf(false) }
    var blocking by rememberSaveable { mutableStateOf(false) }
    var muting by rememberSaveable { mutableStateOf(false) }
    val other = conversation.members.singleOrNull()
    val pick = { choice: Choice ->
        when (choice) {
            Choice.INFO -> onInfo(true)
            Choice.TIMER -> timing = true
            Choice.MUTE -> muting = true
            Choice.UNMUTE -> actions.unmute()
            Choice.BLOCK -> blocking = true
        }
    }
    val muted = conversation.mute != Mute.Off
    MenuButton(muted = muted, canBlock = other != null, onPick = pick)
    if (info) {
        InfoSheet(conversation, muted, onDismiss = { onInfo(false) }) {
            onInfo(false)
            pick(it)
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
    if (muting) {
        MuteDialog(
            onPick = {
                muting = false
                actions.mute(it)
            },
            onDismiss = { muting = false },
        )
    }
    if (blocking && other != null) {
        BlockDialog(
            other,
            onConfirm = {
                blocking = false
                actions.block()
            },
            onDismiss = { blocking = false },
        )
    }
}

private enum class Choice { INFO, TIMER, MUTE, UNMUTE, BLOCK }

/** The menu itself; muted, the mute item turns notifications back on instead. */
@Composable
private fun MenuButton(
    muted: Boolean,
    canBlock: Boolean,
    onPick: (Choice) -> Unit,
) {
    var open by rememberSaveable { mutableStateOf(false) }
    val items =
        listOfNotNull(
            Choice.INFO to R.string.conversation_info,
            Choice.TIMER to R.string.disappearing_messages,
            if (muted) Choice.UNMUTE to R.string.unmute else Choice.MUTE to R.string.mute,
            if (canBlock) Choice.BLOCK to R.string.block else null,
        )
    Box {
        IconButton(onClick = { open = true }) {
            Icon(AppIcons.Menu, contentDescription = stringResource(R.string.more_options), tint = Palette.fg)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            items.forEach { (choice, label) ->
                DropdownMenuItem(
                    text = { Text(stringResource(label)) },
                    onClick = {
                        open = false
                        onPick(choice)
                    },
                )
            }
        }
    }
}

/** Who is in the conversation, then the menu's choices, the timer showing what it is set to (0043). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun InfoSheet(
    conversation: Conversation,
    muted: Boolean,
    onDismiss: () -> Unit,
    onPick: (Choice) -> Unit,
) {
    val members = conversation.members
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Palette.surface) {
        Column(modifier = Modifier.verticalScroll(rememberScrollState()).padding(bottom = 16.dp)) {
            Text(
                text = stringResource(R.string.conversation_info),
                style = MaterialTheme.typography.titleMedium,
                color = Palette.fg,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp).semantics { heading() },
            )
            if (members.size > 1) {
                SectionLabel(
                    text = pluralStringResource(R.plurals.group_member_count, members.size, members.size),
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                )
            }
            members.forEach { person ->
                Row(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .heightIn(min = ROW.dp)
                            .padding(horizontal = 16.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Avatar(person, size = MEMBER_AVATAR.dp)
                    NameWithMark(
                        name = person.shownName(),
                        verified = person.verified,
                        style = MaterialTheme.typography.bodyLarge,
                        color = Palette.fg,
                        markSize = 14.dp,
                        modifier = Modifier.padding(start = 12.dp),
                    )
                }
            }
            HorizontalDivider(color = Palette.border, modifier = Modifier.padding(vertical = 8.dp))
            val timer = conversation.timer
            InfoRow(
                label = stringResource(R.string.disappearing_messages),
                value =
                    timer?.let { stringResource(R.string.disappearing_option, duration(it)) }
                        ?: stringResource(R.string.disappearing_off),
            ) { onPick(Choice.TIMER) }
            if (muted) {
                InfoRow(stringResource(R.string.unmute)) { onPick(Choice.UNMUTE) }
            } else {
                InfoRow(stringResource(R.string.mute)) { onPick(Choice.MUTE) }
            }
            if (members.size == 1) {
                InfoRow(stringResource(R.string.block), color = Palette.danger) { onPick(Choice.BLOCK) }
            }
        }
    }
}

@Composable
private fun InfoRow(
    label: String,
    value: String? = null,
    color: Color = Palette.fg,
    onClick: () -> Unit,
) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = ROW.dp)
                .clickable(role = Role.Button, onClick = onClick)
                .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text(text = label, style = MaterialTheme.typography.bodyLarge, color = color)
        value?.let { Text(text = it, style = MaterialTheme.typography.bodySmall, color = Palette.mutedFg) }
    }
}

/** Asks before blocking `other` (0024). */
@Composable
private fun BlockDialog(
    other: Person,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        text = { Text(stringResource(R.string.block_confirm, other.shownName())) },
        confirmButton = { TextButton(onClick = onConfirm) { Text(stringResource(R.string.block)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
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

/**
 * The three durations 0042 offers, from this menu and from a long press on the list's row (0043); the
 * server sets the end by its own clock.
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

private val MUTES =
    listOf(
        MuteFor.HOUR to R.string.mute_hour,
        MuteFor.EIGHT_HOURS to R.string.mute_eight_hours,
        MuteFor.ALWAYS to R.string.mute_always,
    )

private const val ATTACH = 38
private const val ROW = 48
private const val MEMBER_AVATAR = 36
