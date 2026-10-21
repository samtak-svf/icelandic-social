package samtak.spjall.conversation

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.layout
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.Content
import samtak.spjall.core.Item
import samtak.spjall.core.ItemStatus
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.Palette
import samtak.spjall.ui.Type
import samtak.spjall.ui.clockTime
import samtak.spjall.ui.lastLine
import samtak.spjall.ui.shownName

/** A tombstone is a quiet line, not a bubble: there is nothing left to press. */
@Composable
private fun Tombstone() {
    Text(
        text = stringResource(R.string.message_deleted),
        style = Type.bubble,
        fontStyle = FontStyle.Italic,
        color = Palette.mutedFg,
        modifier = Modifier.padding(horizontal = 4.dp, vertical = 4.dp),
    )
}

/**
 * One message (1c): own on the right in red, the other party's on the left
 * in muted, the corner nearest the sender squared off. Tapping it shows its
 * time (0045); on the newest own message someone read, "Lesin". Its
 * reactions are one pill on its bottom edge.
 */
@Composable
internal fun Bubble(
    row: Row.Bubble,
    group: Boolean,
    media: ConversationViewModel.Media?,
    actions: ConversationActions,
    onDelete: (Item) -> Unit,
    me: String? = null,
) {
    val item = row.item
    var open by rememberSaveable { mutableStateOf(false) }
    var sheet by remember { mutableStateOf(false) }
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .padding(top = if (row.first) 8.dp else 0.dp),
        horizontalAlignment = if (item.own) Alignment.End else Alignment.Start,
    ) {
        if (group && row.first && !item.own) {
            Text(
                text = item.sender.shownName(),
                style = Type.meta,
                color = Palette.mutedFg,
                modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp),
            )
        }
        if (item.content == Content.Deleted) {
            Tombstone()
        } else {
            Message(item, media, actions, onDelete, onTime = { open = !open }) { sheet = true }
        }
        if (sheet) {
            ReactionsSheet(
                item.reactionLines(me),
                onRemove = { emoji -> if (Offer(item).react) actions.react(item, emoji) },
            ) { sheet = false }
        }
        when (item.status) {
            ItemStatus.FAILED -> Failed(actions::resend)
            ItemStatus.PENDING, ItemStatus.SENT -> Meta(row, group, open)
        }
    }
}

/**
 * The bubble itself, its long-press menu, and the reaction pill hanging under
 * its trailing corner (0045). A reply has the message it answers above it.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun Message(
    item: Item,
    media: ConversationViewModel.Media?,
    actions: ConversationActions,
    onDelete: (Item) -> Unit,
    onTime: () -> Unit,
    onReactions: () -> Unit,
) {
    val tap = item.tap(actions)
    val offer = Offer(item)
    val host = LocalMessageMenu.current
    var at by remember { mutableStateOf<LayoutCoordinates?>(null) }
    val pill = item.pill()
    val foreground = if (item.own) Palette.bubbleOwnFg else Palette.bubbleOtherFg
    val copy = copier()
    val entries = menuActions(offer, actions, onDelete, copy)
    val lift = lifter(host, { at }, item, media, foreground, actions, offer, entries)
    val custom =
        accessibilityActions(offer, actions, onDelete, copy, lift) +
            linkActions((item.content as? Content.Text)?.text) +
            placeActions(item.content, actions) +
            listOfNotNull(
                pill?.let {
                    CustomAccessibilityAction(stringResource(R.string.reactions_show)) {
                        onReactions()
                        true
                    }
                },
            )
    val spoken = spokenWith(item, pill)
    val quote = (item.content as? Content.Text)?.replyTo
    Column(
        modifier = Modifier.atMost(BUBBLE_SHARE),
        horizontalAlignment = if (item.own) Alignment.End else Alignment.Start,
    ) {
        quote?.let { QuoteAbove(it, item.own) }
        Box(modifier = Modifier.padding(bottom = if (pill != null) (PILL_HEIGHT - PILL_OVERLAP).dp else 0.dp)) {
            Surface(
                color = bubbleColor(item, media),
                contentColor = foreground,
                shape = bubbleShape(item.own),
                modifier =
                    Modifier
                        // An own bubble narrower than its pill stays flush with the far edge.
                        .align(if (item.own) Alignment.TopEnd else Alignment.TopStart)
                        .onGloballyPositioned { at = it }
                        .semantics(mergeDescendants = true) {
                            customActions = custom
                            stateDescription = spoken
                        }.combinedClickable(
                            onClickLabel = null,
                            // A photo or a file opens; anything else shows or hides its time.
                            onClick = { tap?.invoke() ?: onTime() },
                            onLongClickLabel = stringResource(R.string.react),
                            // Its haptic (0043) is combinedClickable's own, as the system setting allows.
                            onLongClick = lift,
                        ),
            ) {
                Inside(item, media, foreground, actions, onTap = { tap?.invoke() ?: onTime() }, onLongPress = lift)
            }
            pill?.let { HangingPill(it, onReactions) }
        }
    }
}

/** Lifts the bubble over the rest of the conversation (0054), drawn again as it is here. */
private fun lifter(
    host: MessageMenuState?,
    at: () -> LayoutCoordinates?,
    item: Item,
    media: ConversationViewModel.Media?,
    foreground: Color,
    actions: ConversationActions,
    offer: Offer,
    entries: List<MenuAction>,
): () -> Unit =
    {
        at()?.let { coordinates ->
            host?.open =
                MenuRequest(
                    at = coordinates,
                    own = item.own,
                    reactions = if (offer.react) EMOJI else emptyList(),
                    chosen =
                        item.reactions
                            .filter { it.own }
                            .map { it.emoji }
                            .toSet(),
                    onReact = { actions.react(item, it) },
                    actions = entries,
                ) {
                    Surface(
                        color = bubbleColor(item, media),
                        contentColor = foreground,
                        shape = bubbleShape(item.own),
                    ) {
                        Inside(item, media, foreground, actions, onTap = {}, onLongPress = {})
                    }
                }
        }
    }

/** Rounded all round but at the bottom corner on the sender's side. */
private fun bubbleShape(own: Boolean) =
    RoundedCornerShape(
        topStart = BUBBLE_RADIUS.dp,
        topEnd = BUBBLE_RADIUS.dp,
        bottomEnd = (if (own) TAIL_RADIUS else BUBBLE_RADIUS).dp,
        bottomStart = (if (own) BUBBLE_RADIUS else TAIL_RADIUS).dp,
    )

/** At most [fraction] of the width the parent offers: a bubble leaves room on the far side. */
private fun Modifier.atMost(fraction: Float) =
    layout { measurable, constraints ->
        val max = if (constraints.hasBoundedWidth) (constraints.maxWidth * fraction).toInt() else constraints.maxWidth
        val placeable = measurable.measure(constraints.copy(minWidth = 0, maxWidth = max))
        layout(placeable.width, placeable.height) { placeable.place(0, 0) }
    }

/** The long-press menu's entries, for TalkBack. */
@Composable
private fun accessibilityActions(
    offer: Offer,
    actions: ConversationActions,
    onDelete: (Item) -> Unit,
    onCopy: (String) -> Unit,
    onReact: () -> Unit,
): List<CustomAccessibilityAction> {
    val item = offer.item
    return listOfNotNull(
        if (offer.reply) stringResource(R.string.reply) to { actions.reply(item) } else null,
        offer.copy?.let { text -> stringResource(R.string.copy) to { onCopy(text()) } },
        if (offer.forward) stringResource(R.string.forward) to { actions.forward(item) } else null,
        if (offer.edit) stringResource(R.string.edit) to { actions.edit(item) } else null,
        if (offer.delete) stringResource(R.string.delete_for_everyone) to { onDelete(item) } else null,
        if (offer.react) stringResource(R.string.react) to onReact else null,
    ).map { (label, act) ->
        CustomAccessibilityAction(label) {
            act()
            true
        }
    }
}

@Composable
internal fun Body(
    item: Item,
    media: ConversationViewModel.Media?,
    foreground: Color,
    actions: ConversationActions,
    onTap: () -> Unit,
    onLongPress: () -> Unit,
) {
    when (val content = item.content) {
        is Content.Text -> {
            // A reply's quote is drawn above the bubble, by Message.
            LinkedText(content.text, foreground, onTap, onLongPress)
        }
        // Drawn by Bubble as a line of its own.
        Content.Deleted -> Unit
        is Content.Media -> Attachment(item, content, media, foreground, actions)
        is Content.Post -> SharedCard(foreground)
        is Content.Members, is Content.Timer ->
            Text(text = lastLine(item), style = Type.bubble, color = foreground)
        is Content.Unreadable -> Unreadable(content.code, foreground)
        is Content.Location -> LocationCard(content, foreground, actions, onLongPress)
    }
}

/**
 * The small line under a message ([meta]): "breytt", then a clock while
 * sending (0043) or the time once tapped (0045), then who read it.
 */
@Composable
private fun Meta(
    row: Row.Bubble,
    group: Boolean,
    open: Boolean,
) {
    val parts = row.meta(open)
    if (parts.isEmpty()) return
    val item = row.item
    val words =
        parts.mapNotNull {
            when (it) {
                MetaPart.EDITED -> stringResource(R.string.edited_marker)
                MetaPart.TIME -> clockTime(item.at())
                MetaPart.READ -> row.readBy?.let { count -> readLine(count, group) }
                MetaPart.SENDING -> null
            }
        }
    Row(
        modifier = Modifier.padding(horizontal = 4.dp, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (words.isNotEmpty()) {
            Text(text = words.joinToString(" · "), style = Type.meta, color = Palette.mutedFg)
        }
        if (MetaPart.SENDING in parts) {
            Icon(
                AppIcons.Clock,
                contentDescription = stringResource(R.string.message_sending),
                tint = Palette.mutedFg,
                modifier = Modifier.size(CLOCK.dp),
            )
        }
    }
}

@Composable
private fun Failed(onResend: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            text = stringResource(R.string.message_failed),
            style = MaterialTheme.typography.labelMedium,
            color = Palette.danger,
        )
        TextButton(onClick = onResend) { Text(stringResource(R.string.try_again)) }
    }
}

/** Who read the reader's message (0022): "Lesin" in a 1:1, the count in a group; the list's row says the same. */
@Composable
internal fun readLine(
    count: UInt,
    group: Boolean,
): String =
    if (group) {
        pluralStringResource(R.plurals.read_by_count, count.toInt(), count.toInt())
    } else {
        stringResource(R.string.read_marker)
    }

private val EMOJI = listOf("👍", "❤️", "😂", "😮", "😢", "🙏")
private const val BUBBLE_RADIUS = 18

/** A bubble's padding round its text. */
internal const val PAD_X = 14
internal const val PAD_Y = 11
private const val TAIL_RADIUS = 5
private const val BUBBLE_SHARE = 0.76f
private const val CLOCK = 12
