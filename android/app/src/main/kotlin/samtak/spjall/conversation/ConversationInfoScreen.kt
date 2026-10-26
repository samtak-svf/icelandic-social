@file:Suppress("TooManyFunctions")

package samtak.spjall.conversation

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridScope
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.Conversation
import samtak.spjall.core.Mute
import samtak.spjall.core.Person
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.Avatar
import samtak.spjall.ui.CancelButton
import samtak.spjall.ui.NameWithMark
import samtak.spjall.ui.Palette
import samtak.spjall.ui.PhotoKind
import samtak.spjall.ui.ProblemCard
import samtak.spjall.ui.SectionLabel
import samtak.spjall.ui.avatarKind
import samtak.spjall.ui.clockTime
import samtak.spjall.ui.duration
import samtak.spjall.ui.photoOf
import samtak.spjall.ui.shownName
import samtak.spjall.ui.title

/**
 * A conversation's information (0055): who it is with, each setting with its state on its row, and
 * the photos and files sent in it, read from this device. It opens from the title and from the menu,
 * and closes by itself once the conversation is no longer open, after a block.
 */
@Composable
fun ConversationInfoScreen(
    state: ConversationViewModel.State,
    actions: ConversationInfoActions,
) {
    val conversation = state.conversation
    LaunchedEffect(conversation?.hasMenu()) { if (conversation?.hasMenu() == false) actions.back() }
    val grid = rememberLazyGridState()
    val shared = state.shared
    val nearEnd by remember {
        derivedStateOf {
            val last =
                grid.layoutInfo.visibleItemsInfo
                    .lastOrNull()
                    ?.index ?: 0
            last >= grid.layoutInfo.totalItemsCount - MORE_AHEAD
        }
    }
    LaunchedEffect(nearEnd, shared?.items?.size) { if (nearEnd && shared?.more == true) actions.more() }
    val sides = WindowInsetsSides.Horizontal + WindowInsetsSides.Bottom
    // The two ways out of a group (0078), asked for in two places on the screen and answered here.
    var renaming by rememberSaveable { mutableStateOf(false) }
    var leaving by rememberSaveable { mutableStateOf(false) }
    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .background(Palette.bg)
                .windowInsetsPadding(WindowInsets.safeDrawing.only(sides)),
    ) {
        InfoBar(actions)
        state.problem?.let { Box(Modifier.padding(16.dp)) { ProblemCard(it, actions::retry) } }
        if (conversation == null) return@Column
        LazyVerticalGrid(
            columns = GridCells.Fixed(COLUMNS),
            state = grid,
            horizontalArrangement = Arrangement.spacedBy(GAP.dp),
            verticalArrangement = Arrangement.spacedBy(GAP.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            whole("who") { Who(conversation, actions, onRename = { renaming = true }) }
            whole("settings") { Settings(conversation, actions, onLeave = { leaving = true }) }
            shared(shared, state.media, actions)
        }
        if (renaming) {
            RenameDialog(
                current = conversation.name,
                onSave = {
                    renaming = false
                    actions.rename(it)
                },
                onDismiss = { renaming = false },
            )
        }
        if (leaving) {
            LeaveDialog(
                onConfirm = {
                    leaving = false
                    actions.leave()
                },
                onDismiss = { leaving = false },
            )
        }
    }
}

/** Back and the screen's title, on the band the conversation's own bar uses. */
@Composable
private fun InfoBar(actions: ConversationInfoActions) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top))
                .padding(start = 4.dp, end = 4.dp, top = 2.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = actions::back) {
            Icon(AppIcons.Back, contentDescription = stringResource(R.string.back), tint = Palette.fg)
        }
        Text(
            text = stringResource(R.string.conversation_info),
            style = MaterialTheme.typography.titleMedium,
            color = Palette.fg,
            modifier = Modifier.padding(start = 4.dp).semantics { heading() },
        )
    }
    HorizontalDivider(color = Palette.border)
}

/** The other person, large, with their mark; or a group's name, what may be done with it, and everyone in it. */
@Composable
private fun Who(
    conversation: Conversation,
    actions: ConversationInfoActions,
    onRename: () -> Unit,
) {
    // A group is everyone else when it has a name, whatever its size (0078).
    val one = if (conversation.name == null) conversation.members.singleOrNull() else null
    Column(
        modifier = Modifier.fillMaxWidth().padding(top = 24.dp, bottom = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        val photo = conversation.photoOf()
        val alt = stringResource(R.string.group_photo_alt)
        Avatar(
            name = one?.name ?: conversation.title(),
            kind = conversation.avatarKind(),
            size = LARGE_AVATAR.dp,
            photo = photo,
            modifier =
                if (photo?.kind == PhotoKind.GroupFile) Modifier.semantics { contentDescription = alt } else Modifier,
        )
        if (one == null) {
            GroupPhotoControls(hasPhoto = conversation.photo != null, actions::setPhoto, actions::clearPhoto)
        }
        NameWithMark(
            name = one?.shownName() ?: conversation.title(),
            verified = one?.verified == true,
            style = MaterialTheme.typography.titleLarge.copy(textAlign = TextAlign.Center),
            color = Palette.fg,
            markSize = 18.dp,
            modifier = Modifier.padding(top = 12.dp, start = 16.dp, end = 16.dp).semantics { heading() },
        )
        if (one == null) {
            GroupActions(actions::add, onRename)
            Members(conversation) { actions.remove(it.account) }
        }
    }
}

/**
 * Under a group's avatar (0094): choose a photo when it has none, else change or remove it; removing asks first,
 * as it takes the photo from everyone. The line says who sees it.
 */
@Composable
private fun GroupPhotoControls(
    hasPhoto: Boolean,
    onSet: () -> Unit,
    onClear: () -> Unit,
) {
    var removing by rememberSaveable { mutableStateOf(false) }
    Column(
        modifier = Modifier.padding(top = 12.dp, start = 16.dp, end = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        OutlinedButton(onClick = onSet, modifier = Modifier.heightIn(min = ACTION.dp)) {
            Text(stringResource(if (hasPhoto) R.string.group_photo_change else R.string.group_photo_choose))
        }
        if (hasPhoto) {
            TextButton(
                onClick = { removing = true },
                modifier = Modifier.heightIn(min = ACTION.dp),
                colors = ButtonDefaults.textButtonColors(contentColor = Palette.danger),
            ) { Text(stringResource(R.string.group_photo_remove)) }
        }
    }
    Text(
        text = stringResource(R.string.group_photo_seen_by_members),
        style = MaterialTheme.typography.bodySmall,
        color = Palette.mutedFg,
        textAlign = TextAlign.Center,
        modifier = Modifier.padding(horizontal = 24.dp, vertical = 4.dp),
    )
    if (removing) {
        AlertDialog(
            onDismissRequest = { removing = false },
            text = { Text(stringResource(R.string.group_photo_remove_confirm)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        removing = false
                        onClear()
                    },
                    colors = ButtonDefaults.textButtonColors(contentColor = Palette.danger),
                ) { Text(stringResource(R.string.group_photo_remove)) }
            },
            dismissButton = { CancelButton(onClick = { removing = false }) },
        )
    }
}

/** What a group's information offers above its members (0078): more people, or a name. */
@Composable
private fun GroupActions(
    onAdd: () -> Unit,
    onRename: () -> Unit,
) {
    Row(
        modifier = Modifier.padding(top = 16.dp, start = 16.dp, end = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        OutlinedButton(onClick = onAdd, modifier = Modifier.heightIn(min = ACTION.dp)) {
            Icon(
                AppIcons.Plus,
                contentDescription = null,
                tint = Palette.fg,
                modifier = Modifier.padding(end = 6.dp).size(ACTION_ICON.dp),
            )
            Text(stringResource(R.string.add_people))
        }
        OutlinedButton(onClick = onRename, modifier = Modifier.heightIn(min = ACTION.dp)) {
            Icon(
                AppIcons.Edit,
                contentDescription = null,
                tint = Palette.fg,
                modifier = Modifier.padding(end = 6.dp).size(ACTION_ICON.dp),
            )
            Text(stringResource(R.string.group_name))
        }
    }
}

@Composable
private fun Members(
    conversation: Conversation,
    onRemove: (Person) -> Unit,
) {
    val members = conversation.members
    var removing by remember { mutableStateOf<Person?>(null) }
    SectionLabel(
        text = pluralStringResource(R.plurals.group_member_count, members.size, members.size),
        modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 20.dp, bottom = 4.dp),
    )
    members.forEach { person ->
        Row(
            modifier = Modifier.fillMaxWidth().heightIn(min = ROW.dp).padding(horizontal = 16.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Avatar(person, size = MEMBER_AVATAR.dp)
            NameWithMark(
                name = person.shownName(),
                verified = person.verified,
                style = MaterialTheme.typography.bodyLarge,
                color = Palette.fg,
                markSize = 14.dp,
                modifier = Modifier.weight(1f).padding(start = 12.dp),
            )
            // It takes someone out for everyone, so it asks first (0078).
            IconButton(onClick = { removing = person }) {
                Icon(
                    AppIcons.Trash,
                    contentDescription = stringResource(R.string.remove_member),
                    tint = Palette.mutedFg,
                )
            }
        }
    }
    removing?.let { person ->
        AlertDialog(
            onDismissRequest = { removing = null },
            text = { Text(stringResource(R.string.remove_member_confirm, person.shownName())) },
            confirmButton = {
                TextButton(
                    onClick = {
                        removing = null
                        onRemove(person)
                    },
                    colors = ButtonDefaults.textButtonColors(contentColor = Palette.danger),
                ) { Text(stringResource(R.string.remove_member)) }
            },
            dismissButton = { CancelButton(onClick = { removing = null }) },
        )
    }
}

/** The timer and mute rows say what they are set to (0055); block is last in a 1:1, as leaving is in a group (0078). */
@Composable
private fun Settings(
    conversation: Conversation,
    actions: ConversationInfoActions,
    onLeave: () -> Unit,
) {
    var timing by rememberSaveable { mutableStateOf(false) }
    var muting by rememberSaveable { mutableStateOf(false) }
    var blocking by rememberSaveable { mutableStateOf(false) }
    val other = if (conversation.name == null) conversation.members.singleOrNull() else null
    Column(modifier = Modifier.fillMaxWidth()) {
        HorizontalDivider(color = Palette.border, modifier = Modifier.padding(vertical = 8.dp))
        InfoRow(stringResource(R.string.disappearing_messages), timerState(conversation.timer)) { timing = true }
        val muted = conversation.mute != Mute.Off
        InfoRow(
            label = stringResource(if (muted) R.string.unmute else R.string.mute),
            value = muteState(conversation.mute),
        ) { if (muted) actions.unmute() else muting = true }
        if (other != null) {
            InfoRow(stringResource(R.string.block), color = Palette.danger) { blocking = true }
        } else {
            InfoRow(stringResource(R.string.leave_group), color = Palette.danger, onClick = onLeave)
        }
        HorizontalDivider(color = Palette.border, modifier = Modifier.padding(top = 8.dp))
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
        BlockDialog(other, onConfirm = {
            blocking = false
            actions.block()
        }, onDismiss = { blocking = false })
    }
}

/** Asks before leaving the group (0078): the store keeps what was said, but no more comes. */
@Composable
private fun LeaveDialog(
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        text = { Text(stringResource(R.string.leave_group_confirm)) },
        confirmButton = {
            TextButton(onClick = onConfirm, colors = ButtonDefaults.textButtonColors(contentColor = Palette.danger)) {
                Text(stringResource(R.string.leave_group))
            }
        },
        dismissButton = { CancelButton(onClick = onDismiss) },
    )
}

/**
 * Names the group, or takes its name away (0078). Everyone in it is told; with no name the group is
 * titled by its members again.
 */
@Composable
private fun RenameDialog(
    current: String?,
    onSave: (String?) -> Unit,
    onDismiss: () -> Unit,
) {
    var text by rememberSaveable { mutableStateOf(current.orEmpty()) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.group_name_title)) },
        text = {
            OutlinedTextField(
                value = text,
                onValueChange = { if (it.length <= NAME_LIMIT) text = it },
                placeholder = { Text(stringResource(R.string.group_name_hint)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        },
        confirmButton = {
            TextButton(onClick = { onSave(text.trim().ifEmpty { null }) }) {
                Text(stringResource(R.string.save))
            }
        },
        dismissButton = {
            Row {
                if (!current.isNullOrEmpty()) {
                    TextButton(
                        onClick = { onSave(null) },
                        colors = ButtonDefaults.textButtonColors(contentColor = Palette.danger),
                    ) { Text(stringResource(R.string.group_name_remove)) }
                }
                CancelButton(onClick = onDismiss)
            }
        },
    )
}

/** What the timer is set to, as the menu's choices say it. */
@Composable
internal fun timerState(seconds: UInt?): String =
    seconds?.let { stringResource(R.string.disappearing_option, duration(it)) }
        ?: stringResource(R.string.disappearing_off)

/** Whether the conversation is muted, and until when (0042, 0055). */
@Composable
internal fun muteState(mute: Mute): String =
    when (mute) {
        Mute.Off -> stringResource(R.string.mute_off)
        is Mute.Until -> stringResource(R.string.muted_until, clockTime(mute.at))
        Mute.Always -> stringResource(R.string.muted_always)
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

/** The photos as a grid and the files as rows, each newest first (0055). */
private fun LazyGridScope.shared(
    shared: ConversationViewModel.Shared?,
    media: Map<ULong, ConversationViewModel.Media>,
    actions: ConversationInfoActions,
) {
    whole("shared") {
        SectionLabel(
            text = stringResource(R.string.shared_media),
            modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 8.dp),
        )
    }
    if (shared == null || !shared.loaded) return
    if (shared.items.isEmpty()) {
        whole("empty") {
            Text(
                text = stringResource(R.string.shared_media_empty),
                style = MaterialTheme.typography.bodyMedium,
                color = Palette.mutedFg,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(24.dp),
            )
        }
        return
    }
    val (photos, files) = shared.items.partition { it.isPhoto() }
    items(photos, key = { "photo-${it.seq}" }) { item ->
        SharedPhoto(item, media[item.seq], actions)
    }
    items(files, key = { "file-${it.seq}" }, span = { GridItemSpan(maxLineSpan) }) { item ->
        SharedFile(item, media[item.seq], actions)
    }
}

private fun LazyGridScope.whole(
    key: String,
    content: @Composable () -> Unit,
) = item(key = key, span = { GridItemSpan(maxLineSpan) }) { content() }

private const val COLUMNS = 3
private const val GAP = 2
private const val MORE_AHEAD = 6
private const val ROW = 48
private const val ACTION = 40
private const val ACTION_ICON = 16
private const val LARGE_AVATAR = 96
private const val MEMBER_AVATAR = 36

/** The longest a group's name may be (0078): a title, not a sentence. */
private const val NAME_LIMIT = 64
