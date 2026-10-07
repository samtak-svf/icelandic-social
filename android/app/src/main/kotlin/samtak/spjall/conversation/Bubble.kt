package samtak.spjall.conversation

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.BrandTokens.Colors
import samtak.spjall.brand.R
import samtak.spjall.core.Content
import samtak.spjall.core.Item
import samtak.spjall.core.ItemStatus
import samtak.spjall.ui.lastLine
import samtak.spjall.ui.shownName
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/** What a long press offers on this item. */
private class Offer(
    val item: Item,
) {
    private val sent = item.seq != null && item.envelopeId != null
    private val live = sent && item.content != Content.Deleted
    val reply = live
    val react = live
    val edit = live && item.own && item.content is Content.Text
    val delete = live && item.own
    val any = reply || react || edit || delete
}

/** One message: own on the right, its reactions, and a read line under the newest read. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun Bubble(
    row: Row.Bubble,
    group: Boolean,
    media: ConversationViewModel.Media?,
    actions: ConversationActions,
    onDelete: (Item) -> Unit,
) {
    val item = row.item
    val attached = item.content is Content.Media
    val offer = Offer(item)
    var menu by remember { mutableStateOf(false) }
    val background = Color(if (item.own) Colors.BUBBLE_OWN_BG else Colors.BUBBLE_OTHER_BG)
    val foreground = Color(if (item.own) Colors.BUBBLE_OWN_FG else Colors.BUBBLE_OTHER_FG)
    val custom = accessibilityActions(offer, actions, onDelete) { menu = true }
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp)
                .padding(top = if (row.first) 8.dp else 0.dp),
        horizontalAlignment = if (item.own) Alignment.End else Alignment.Start,
    ) {
        if (group && row.first && !item.own) {
            Text(
                text = item.sender.shownName(),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 2.dp),
            )
        }
        Box {
            Surface(
                color = background,
                contentColor = foreground,
                shape = RoundedCornerShape(BUBBLE_RADIUS.dp),
                modifier =
                    Modifier
                        .widthIn(max = BUBBLE_WIDTH.dp)
                        .semantics(mergeDescendants = true) { customActions = custom }
                        .combinedClickable(
                            enabled = offer.any || attached,
                            onClickLabel = null,
                            // A photo or file opens on a tap.
                            onClick = { if (attached) actions.open(item) },
                            onLongClickLabel = stringResource(R.string.react),
                            onLongClick = { menu = true },
                        ),
            ) {
                Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                    Body(item, media, foreground, actions)
                    Meta(item, foreground)
                }
            }
            Menu(menu, offer, actions, onDelete) { menu = false }
        }
        if (item.reactions.isNotEmpty()) Reactions(item, offer.react, actions)
        when (item.status) {
            ItemStatus.FAILED -> Failed(actions::resend)
            ItemStatus.PENDING, ItemStatus.SENT -> Unit
        }
        row.readBy?.let { ReadLine(it, group) }
    }
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
            content.replyTo?.let { quote ->
                Column(modifier = Modifier.padding(bottom = 4.dp)) {
                    Text(
                        text = quote.sender?.shownName() ?: "",
                        style = MaterialTheme.typography.labelMedium,
                        color = foreground,
                    )
                    Text(
                        text = quote.text ?: stringResource(R.string.message_deleted),
                        style = MaterialTheme.typography.bodySmall,
                        fontStyle = FontStyle.Italic,
                        color = foreground,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    HorizontalDivider(color = foreground, modifier = Modifier.padding(top = 4.dp))
                }
            }
            Text(text = content.text, style = MaterialTheme.typography.bodyLarge, color = foreground)
        }
        Content.Deleted ->
            Text(
                text = stringResource(R.string.message_deleted),
                style = MaterialTheme.typography.bodyLarge,
                fontStyle = FontStyle.Italic,
                color = foreground,
            )
        is Content.Media -> Attachment(item, content, media, foreground, actions)
        is Content.Members, is Content.Timer ->
            Text(text = lastLine(item), style = MaterialTheme.typography.bodyLarge, color = foreground)
    }
}

@Composable
private fun ColumnScope.Meta(
    item: Item,
    foreground: Color,
) {
    val parts =
        listOfNotNull(
            if (item.edited) stringResource(R.string.edited_marker) else null,
            when (item.status) {
                ItemStatus.PENDING -> stringResource(R.string.message_sending)
                ItemStatus.SENT, ItemStatus.FAILED -> clock(item.ts)
            },
        )
    Text(
        text = parts.joinToString(" · "),
        style = MaterialTheme.typography.labelSmall,
        color = foreground,
        modifier = Modifier.align(Alignment.End),
    )
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
private fun Reactions(
    item: Item,
    enabled: Boolean,
    actions: ConversationActions,
) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        modifier = Modifier.padding(top = 2.dp),
    ) {
        item.reactions.forEach { reaction ->
            // Own reactions take the gold chip pair, the others fg on muted.
            Surface(
                onClick = { actions.react(item, reaction.emoji) },
                enabled = enabled,
                shape = RoundedCornerShape(CHIP_RADIUS.dp),
                color = Color(if (reaction.own) Colors.SECONDARY else Colors.MUTED),
                contentColor = Color(if (reaction.own) Colors.SECONDARY_FG else Colors.FG),
            ) {
                Text(
                    text = "${reaction.emoji} ${reaction.people.size}",
                    style = MaterialTheme.typography.labelLarge,
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                )
            }
        }
    }
}

@Composable
private fun Failed(onResend: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            text = stringResource(R.string.message_failed),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.error,
        )
        TextButton(onClick = onResend) { Text(stringResource(R.string.try_again)) }
    }
}

@Composable
private fun ReadLine(
    count: UInt,
    group: Boolean,
) {
    Text(
        text =
            if (group) {
                pluralStringResource(R.plurals.read_by_count, count.toInt(), count.toInt())
            } else {
                stringResource(R.string.read_marker)
            },
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp),
    )
}

private fun clock(millis: ULong): String =
    DateTimeFormatter
        .ofLocalizedTime(FormatStyle.SHORT)
        .format(Instant.ofEpochMilli(millis.toLong()).atZone(ZoneId.systemDefault()))

private val EMOJI = listOf("👍", "❤️", "😂", "😮", "😢", "🙏")
private const val BUBBLE_RADIUS = 18
private const val BUBBLE_WIDTH = 320
private const val CHIP_RADIUS = 12
