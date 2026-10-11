package samtak.spjall.conversation

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
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
import androidx.compose.ui.layout.layout
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

/** What a long press offers on this item. */
private class Offer(
    val item: Item,
) {
    private val sent = item.seq != null && item.envelopeId != null
    private val live = sent && item.content != Content.Deleted
    val reply = live

    /**
     * Text or a file, not under a timer, where a copy would outlive the original (0041); never a
     * shared post (0044).
     */
    val forward =
        live &&
            item.expiresAt == null &&
            (item.content is Content.Text || item.content is Content.Media)
    val react = live
    val edit = live && item.own && item.content is Content.Text
    val delete = live && item.own
    val any = reply || react || edit || delete
}

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

/** The bubble itself, its long-press menu, and the reaction pill on its bottom edge (0045). */
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
    var menu by remember { mutableStateOf(false) }
    val pill = item.pill()
    val foreground = if (item.own) Palette.bubbleOwnFg else Palette.bubbleOtherFg
    val custom =
        accessibilityActions(offer, actions, onDelete) { menu = true } +
            listOfNotNull(
                pill?.let {
                    CustomAccessibilityAction(stringResource(R.string.reactions_show)) {
                        onReactions()
                        true
                    }
                },
            )
    val spoken = spokenWith(item, pill)
    Box(
        modifier =
            Modifier
                .atMost(BUBBLE_SHARE)
                .padding(bottom = if (pill != null) (PILL_HEIGHT / 2).dp else 0.dp),
    ) {
        Surface(
            color = if (item.own) Palette.bubbleOwnBg else Palette.bubbleOtherBg,
            contentColor = foreground,
            shape = bubbleShape(item.own),
            modifier =
                Modifier
                    .semantics(mergeDescendants = true) {
                        customActions = custom
                        stateDescription = spoken
                    }.combinedClickable(
                        onClickLabel = null,
                        // A photo or a file opens; anything else shows or hides its time.
                        onClick = { tap?.invoke() ?: onTime() },
                        onLongClickLabel = stringResource(R.string.react),
                        // Its haptic (0043) is combinedClickable's own, as the system setting allows.
                        onLongClick = { menu = true },
                    ),
        ) {
            Column(modifier = Modifier.padding(horizontal = 14.dp, vertical = 11.dp)) {
                if (item.forwarded) ForwardedMark(foreground)
                Body(item, media, foreground, actions)
            }
        }
        pill?.let {
            ReactionPill(
                it,
                onClick = onReactions,
                modifier =
                    Modifier
                        .align(if (item.own) Alignment.BottomStart else Alignment.BottomEnd)
                        .offset(x = if (item.own) -PILL_INSET.dp else PILL_INSET.dp, y = (PILL_HEIGHT / 2).dp),
            )
        }
        Menu(menu, offer, actions, onDelete) { menu = false }
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
    onReact: () -> Unit,
): List<CustomAccessibilityAction> {
    val item = offer.item
    return listOfNotNull(
        if (offer.reply) stringResource(R.string.reply) to { actions.reply(item) } else null,
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
private fun Body(
    item: Item,
    media: ConversationViewModel.Media?,
    foreground: Color,
    actions: ConversationActions,
) {
    when (val content = item.content) {
        is Content.Text -> {
            content.replyTo?.let { Quoted(it, foreground) }
            Text(text = content.text, style = Type.bubble, color = foreground)
        }
        // Drawn by Bubble as a line of its own.
        Content.Deleted -> Unit
        is Content.Media -> Attachment(item, content, media, foreground, actions)
        is Content.Post -> SharedCard(foreground)
        is Content.Members, is Content.Timer ->
            Text(text = lastLine(item), style = Type.bubble, color = foreground)
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
                MetaPart.TIME -> clockTime(item.ts)
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
private fun Menu(
    open: Boolean,
    offer: Offer,
    actions: ConversationActions,
    onDelete: (Item) -> Unit,
    onDismiss: () -> Unit,
) {
    DropdownMenu(expanded = open, onDismissRequest = onDismiss) {
        if (offer.react) {
            Row(modifier = Modifier.padding(horizontal = 8.dp)) {
                EMOJI.forEach { emoji ->
                    TextButton(onClick = {
                        onDismiss()
                        actions.react(offer.item, emoji)
                    }) { Text(emoji, style = MaterialTheme.typography.titleLarge) }
                }
            }
        }
        listOfNotNull(
            if (offer.reply) R.string.reply to { actions.reply(offer.item) } else null,
            if (offer.forward) R.string.forward to { actions.forward(offer.item) } else null,
            if (offer.edit) R.string.edit to { actions.edit(offer.item) } else null,
            if (offer.delete) R.string.delete_for_everyone to { onDelete(offer.item) } else null,
        ).forEach { (label, act) ->
            DropdownMenuItem(text = { Text(stringResource(label)) }, onClick = {
                onDismiss()
                act()
            })
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
private const val TAIL_RADIUS = 5
private const val BUBBLE_SHARE = 0.76f
private const val PILL_INSET = 4
private const val CLOCK = 12
