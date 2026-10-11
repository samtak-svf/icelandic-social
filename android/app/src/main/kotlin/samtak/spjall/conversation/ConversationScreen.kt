package samtak.spjall.conversation

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.plus
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import samtak.spjall.brand.R
import samtak.spjall.core.Conversation
import samtak.spjall.core.ConversationState
import samtak.spjall.core.Item
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.Palette
import samtak.spjall.ui.ProblemCard
import samtak.spjall.ui.RoundButton
import samtak.spjall.ui.SansFamily
import samtak.spjall.ui.SectionLabel
import samtak.spjall.ui.dayHeading
import samtak.spjall.ui.lastLine
import samtak.spjall.ui.shownName
import java.time.LocalDate

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
    // No one else is here once a block ends a 1:1: nothing to send to.
    val writable =
        conversation?.let { it.state.open() && it.members.isNotEmpty() } ?: false
    var deleting by remember { mutableStateOf<Item?>(null) }
    Surface(modifier = Modifier.fillMaxSize(), color = Palette.surface) {
        // The header pads for the status bar itself, so its cream reaches the top edge.
        val sides = WindowInsetsSides.Horizontal + WindowInsetsSides.Bottom
        Column(modifier = Modifier.windowInsetsPadding(WindowInsets.safeDrawing.only(sides))) {
            TopBar(state, actions)
            conversation?.let { Banner(it) }
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

private fun ConversationState.open() = this == ConversationState.ACTIVE || this == ConversationState.NEW

@Composable
private fun Banner(conversation: Conversation) {
    val text =
        when (conversation.state) {
            ConversationState.REMOVED -> R.string.conversation_removed_banner
            ConversationState.EXCLUDED -> R.string.conversation_excluded_banner
            ConversationState.STALE -> R.string.conversation_stale_banner
            ConversationState.NEW, ConversationState.ACTIVE ->
                if (conversation.members.isEmpty()) R.string.conversation_alone_banner else return
        }
    Text(
        text = stringResource(text),
        style = MaterialTheme.typography.bodyMedium,
        color = Palette.fg,
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp)
                .background(Palette.secondarySubtle, RoundedCornerShape(BANNER_RADIUS.dp))
                .padding(horizontal = 14.dp, vertical = 13.dp),
    )
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
    // A new item at the bottom comes into view when it is own, or when the
    // newest was in view; someone reading further up stays where they are.
    val newest = rows.firstOrNull()
    LaunchedEffect(newest?.key) {
        val own = (newest as? Row.Bubble)?.item?.own == true
        if (newest != null && (own || list.firstVisibleItemIndex <= 1)) list.animateScrollToItem(0)
    }
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
                is Row.Card -> CardLine(row.item, group)
                is Row.Bubble ->
                    Bubble(
                        row,
                        group,
                        row.item.seq?.let { state.media[it] },
                        state.posts,
                        actions,
                        onDelete,
                    )
            }
        }
    }
}

@Composable
private fun DayLine(date: LocalDate) {
    SectionLabel(
        text = dayHeading(date),
        align = TextAlign.Center,
        modifier = Modifier.fillMaxWidth().padding(top = 16.dp, bottom = 6.dp).semantics { heading() },
    )
}

@Composable
private fun CardLine(
    item: Item,
    group: Boolean,
) {
    Text(
        text = lastLine(item, group),
        style = MaterialTheme.typography.bodySmall,
        color = Palette.mutedFg,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 32.dp, vertical = 8.dp),
        textAlign = TextAlign.Center,
    )
}

/**
 * Three dots in a muted pill, where the next message will appear. TalkBack
 * reads who types: a 1:1 names them; in a group the frame's sender is not
 * known (0022).
 */
@Composable
private fun TypingRow(name: String?) {
    val description =
        name?.let { stringResource(R.string.typing_indicator, it) }
            ?: stringResource(R.string.typing_indicator_group)
    Box(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)) {
        Row(
            modifier =
                Modifier
                    .background(Palette.muted, RoundedCornerShape(BUBBLE_PILL.dp))
                    .padding(horizontal = 14.dp, vertical = 9.dp)
                    .clearAndSetSemantics {
                        contentDescription = description
                        liveRegion = LiveRegionMode.Polite
                    },
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            DOT_ALPHAS.forEach { alpha ->
                Box(modifier = Modifier.size(DOT.dp).background(Palette.mutedFg.copy(alpha = alpha), CircleShape))
            }
        }
    }
}

/**
 * A pill to write in and one action beside it (1c, 1f, 0043). The pill is muted until it
 * has focus, then white with a dark edge, as the keyboard comes up.
 */
@Composable
private fun Composer(
    state: ConversationViewModel.State,
    actions: ConversationActions,
) {
    Column(modifier = Modifier.fillMaxWidth()) {
        HorizontalDivider(color = Palette.border)
        when (val mode = state.mode) {
            ConversationViewModel.Mode.New -> Unit
            is ConversationViewModel.Mode.Reply -> ModeLine(R.string.reply, lastLine(mode.item), actions::cancelMode)
            is ConversationViewModel.Mode.Edit -> ModeLine(R.string.edit, lastLine(mode.item), actions::cancelMode)
        }
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Spacer(Modifier.width(12.dp))
            Field(state.draft, actions::draft, Modifier.weight(1f))
            // One action at a time, in one place (0043): attach while the field
            // is empty, send once it has text; replying or editing keeps send.
            when (state.action) {
                ConversationViewModel.ComposerAction.ATTACH -> AttachButton(actions)
                ConversationViewModel.ComposerAction.SEND -> {
                    val ready = state.draft.isNotBlank()
                    RoundButton(
                        icon = AppIcons.Send,
                        description = stringResource(R.string.send),
                        onClick = actions::send,
                        enabled = ready,
                        fill = if (ready) Palette.primary else Palette.muted,
                        tint = if (ready) Palette.primaryFg else Palette.mutedFg,
                        size = SEND.dp,
                    )
                }
            }
        }
    }
}

@Composable
private fun Field(
    value: String,
    onChange: (String) -> Unit,
    modifier: Modifier,
) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val shape = RoundedCornerShape(FIELD_RADIUS.dp)
    BasicTextField(
        value = value,
        onValueChange = onChange,
        maxLines = COMPOSER_LINES,
        textStyle = FIELD.copy(color = Palette.fg),
        cursorBrush = SolidColor(Palette.fg),
        interactionSource = interaction,
        modifier =
            modifier
                .heightIn(min = FIELD_HEIGHT.dp)
                .background(if (focused) Palette.surface else Palette.muted, shape)
                .border(FIELD_EDGE.dp, if (focused) Palette.fg else Color.Transparent, shape),
        decorationBox = { inner ->
            Box(
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
                contentAlignment = Alignment.CenterStart,
            ) {
                if (value.isEmpty()) {
                    Text(text = stringResource(R.string.composer_placeholder), style = FIELD, color = Palette.mutedFg)
                }
                inner()
            }
        },
    )
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
            Text(text = stringResource(label), style = MaterialTheme.typography.labelMedium, color = Palette.fg)
            Text(
                text = text,
                style = MaterialTheme.typography.bodySmall,
                color = Palette.mutedFg,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        IconButton(onClick = onCancel) {
            Icon(Icons.Filled.Close, contentDescription = stringResource(R.string.cancel), tint = Palette.fg)
        }
    }
}

private const val OLDER_AHEAD = 10
private const val COMPOSER_LINES = 5
private const val BANNER_RADIUS = 14
private const val BUBBLE_PILL = 18
private const val DOT = 6
private const val SEND = 40
private const val FIELD_HEIGHT = 40
private const val FIELD_RADIUS = 20
private const val FIELD_EDGE = 1.5f

/** The typing dots fade from left to right, as in the design. */
private val DOT_ALPHAS = listOf(1f, 0.7f, 0.4f)

private val FIELD =
    TextStyle(fontFamily = SansFamily, fontWeight = FontWeight.Medium, fontSize = 14.sp, lineHeight = 20.sp)
