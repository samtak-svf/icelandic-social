package samtak.spjall.conversation

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import samtak.spjall.brand.R
import samtak.spjall.core.ConversationState
import samtak.spjall.core.Item
import samtak.spjall.ui.ProblemCard
import samtak.spjall.ui.VerifiedMark
import samtak.spjall.ui.lastLine
import samtak.spjall.ui.shownName
import samtak.spjall.ui.title
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/**
 * One conversation (1c): bubbles, own on the right, the composer below, and
 * long press for reply, edit, delete for everyone and reactions. Each bubble
 * is one node for TalkBack, with the same actions as custom actions.
 */
@Composable
fun ConversationScreen(
    state: ConversationViewModel.State,
    actions: ConversationActions,
) {
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) { actions.paused() }
    DisposableEffect(Unit) { onDispose { actions.paused() } }
    val conversation = state.conversation
    val group = (conversation?.members?.size ?: 0) > 1
    val writable = conversation?.state.let { it == ConversationState.ACTIVE || it == ConversationState.NEW }
    var deleting by remember { mutableStateOf<Item?>(null) }
    Surface(modifier = Modifier.fillMaxSize()) {
        Column(modifier = Modifier.safeDrawingPadding().imePadding()) {
            TopBar(state, actions::back)
            conversation?.let { Banner(it.state) }
            state.problem?.let { Box(Modifier.padding(16.dp)) { ProblemCard(it, actions::retry) } }
            Timeline(
                state = state,
                group = group,
                actions = actions,
                onDelete = { deleting = it },
                modifier = Modifier.weight(1f),
            )
            if (state.typing) {
                TypingRow(
                    conversation
                        ?.members
                        ?.singleOrNull()
                        ?.shownName()
                        .takeUnless { group },
                )
            }
            if (writable) Composer(state, actions)
        }
    }
    deleting?.let { item ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            text = { Text(stringResource(R.string.delete_confirm)) },
            confirmButton = {
                TextButton(onClick = {
                    deleting = null
                    actions.delete(item)
                }) { Text(stringResource(R.string.delete_for_everyone)) }
            },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text(stringResource(R.string.cancel)) } },
        )
    }
}

@Composable
private fun TopBar(
    state: ConversationViewModel.State,
    onBack: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(end = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        IconButton(onClick = onBack) {
            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.back))
        }
        state.conversation?.let {
            Text(
                text = it.title(),
                style = MaterialTheme.typography.titleLarge,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false).semantics { heading() },
            )
            if (it.members.size == 1 && it.members.single().verified) VerifiedMark()
        }
    }
}

@Composable
private fun Banner(state: ConversationState) {
    val text =
        when (state) {
            ConversationState.REMOVED -> R.string.conversation_removed_banner
            ConversationState.EXCLUDED -> R.string.conversation_excluded_banner
            ConversationState.STALE -> R.string.conversation_stale_banner
            ConversationState.NEW, ConversationState.ACTIVE -> return
        }
    Card(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Text(
            text = stringResource(text),
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.padding(16.dp),
        )
    }
}

/** Newest at the bottom: the list is reversed, so it stays there as items arrive. */
@Composable
private fun Timeline(
    state: ConversationViewModel.State,
    group: Boolean,
    actions: ConversationActions,
    onDelete: (Item) -> Unit,
    modifier: Modifier,
) {
    val rows = remember(state.items) { rows(state.items).asReversed() }
    val list = rememberLazyListState()
    LaunchedEffect(list, rows.size) {
        snapshotFlow {
            list.layoutInfo.visibleItemsInfo
                .lastOrNull()
                ?.index ?: 0
        }.collect { if (it >= rows.size - OLDER_AHEAD) actions.loadOlder() }
    }
    LazyColumn(
        state = list,
        reverseLayout = true,
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        items(rows, key = { it.key }) { row ->
            when (row) {
                is Row.Day -> DayLine(row.date)
                is Row.Card -> CardLine(row.item)
                is Row.Bubble -> Bubble(row, group, actions, onDelete)
            }
        }
    }
}

@Composable
private fun DayLine(date: LocalDate) {
    val today = LocalDate.now()
    val text =
        when (date) {
            today -> stringResource(R.string.day_today)
            today.minusDays(1) -> stringResource(R.string.day_yesterday)
            else -> DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).format(date)
        }
    Text(
        text = text,
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp).semantics { heading() },
        textAlign = TextAlign.Center,
    )
}

@Composable
private fun CardLine(item: Item) {
    Text(
        text = lastLine(item),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 32.dp, vertical = 8.dp),
        textAlign = TextAlign.Center,
    )
}

/** A 1:1 names who types; in a group the frame's sender is not known (0022). */
@Composable
private fun TypingRow(name: String?) {
    Text(
        text =
            name?.let { stringResource(R.string.typing_indicator, it) }
                ?: stringResource(R.string.typing_indicator_group),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 4.dp)
                .semantics { liveRegion = LiveRegionMode.Polite },
    )
}

@Composable
private fun Composer(
    state: ConversationViewModel.State,
    actions: ConversationActions,
) {
    Column(modifier = Modifier.fillMaxWidth()) {
        HorizontalDivider()
        when (val mode = state.mode) {
            ConversationViewModel.Mode.New -> Unit
            is ConversationViewModel.Mode.Reply -> ModeLine(R.string.reply, lastLine(mode.item), actions::cancelMode)
            is ConversationViewModel.Mode.Edit -> ModeLine(R.string.edit, lastLine(mode.item), actions::cancelMode)
        }
        Row(
            modifier = Modifier.fillMaxWidth().padding(8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedTextField(
                value = state.draft,
                onValueChange = actions::draft,
                placeholder = { Text(stringResource(R.string.composer_placeholder)) },
                maxLines = COMPOSER_LINES,
                modifier = Modifier.weight(1f),
            )
            IconButton(onClick = actions::send, enabled = state.draft.isNotBlank()) {
                Icon(Icons.AutoMirrored.Filled.Send, contentDescription = stringResource(R.string.send))
            }
        }
    }
}

@Composable
private fun ModeLine(
    label: Int,
    text: String,
    onCancel: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(start = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(text = stringResource(label), style = MaterialTheme.typography.labelMedium)
            Text(
                text = text,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        IconButton(onClick = onCancel) {
            Icon(Icons.Filled.Close, contentDescription = stringResource(R.string.cancel))
        }
    }
}

private const val OLDER_AHEAD = 10
private const val COMPOSER_LINES = 5
