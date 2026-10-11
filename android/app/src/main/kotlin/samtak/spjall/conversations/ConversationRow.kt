package samtak.spjall.conversations

import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import samtak.spjall.brand.R
import samtak.spjall.conversation.MuteDialog
import samtak.spjall.conversation.readLine
import samtak.spjall.core.Content
import samtak.spjall.core.Conversation
import samtak.spjall.core.Item
import samtak.spjall.core.ItemStatus
import samtak.spjall.core.Mute
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.Avatar
import samtak.spjall.ui.Palette
import samtak.spjall.ui.SansFamily
import samtak.spjall.ui.VerifiedMark
import samtak.spjall.ui.avatarKind
import samtak.spjall.ui.firstName
import samtak.spjall.ui.lastLine
import samtak.spjall.ui.listStamp
import samtak.spjall.ui.photoOf
import samtak.spjall.ui.title

// A row of the conversation list (1a, decisions 0022, 0042, 0043).

/**
 * One conversation: a tap opens it, a long press offers its mute (0042, 0043). There is no swipe (0022):
 * a hidden swipe is found by accident.
 */
@Composable
internal fun ConversationRow(
    conversation: Conversation,
    typing: Boolean,
    actions: ConversationsActions,
) {
    val unread = conversation.unread > 0u
    // A mute silences, it does not hide (0042): the count stays, in the muted colour, and nothing calls out.
    val muted = conversation.mute != Mute.Off
    val calling = unread && !muted
    var menu by remember { mutableStateOf(false) }
    var muting by rememberSaveable(conversation.id) { mutableStateOf(false) }
    Box {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .background(if (calling) Palette.primarySubtle else Color.Transparent)
                    .combinedClickable(
                        onClick = { actions.open(conversation.id) },
                        onLongClickLabel = stringResource(if (muted) R.string.unmute else R.string.mute),
                        // The long press's haptic (0043) is combinedClickable's own, as the system setting allows.
                        onLongClick = { menu = true },
                    ).padding(horizontal = 20.dp, vertical = 13.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            RowBody(conversation, typing = typing, muted = muted, calling = calling)
        }
        // The same choice as the conversation's own menu: mute, which asks for how long, or turn back on.
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            DropdownMenuItem(
                text = { Text(stringResource(if (muted) R.string.unmute else R.string.mute)) },
                onClick = {
                    menu = false
                    if (muted) actions.unmute(conversation.id) else muting = true
                },
            )
        }
    }
    if (muting) {
        MuteDialog(
            onPick = {
                muting = false
                actions.mute(conversation.id, it)
            },
            onDismiss = { muting = false },
        )
    }
}

/** The avatar, the title over the second line, and the row's right side. */
@Composable
private fun RowScope.RowBody(
    conversation: Conversation,
    typing: Boolean,
    muted: Boolean,
    calling: Boolean,
) {
    val title = conversation.title()
    val last = conversation.last
    // A group's circle carries the group's initials, a 1:1's the other person's.
    val initialsOf = if (conversation.members.size > 1) title else conversation.members.firstOrNull()?.name
    Avatar(initialsOf, kind = conversation.avatarKind(), photo = conversation.photoOf())
    Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            Text(
                text = title,
                style = NAME,
                color = Palette.fg,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false),
            )
            // One member's mark: a group's title names several people.
            if (conversation.members.size == 1 && conversation.members.single().verified) VerifiedMark()
        }
        when {
            // In place of the preview, naming no one: the row's title already says who, or it is a group (0022).
            typing -> Text(text = stringResource(R.string.typing_in_row), style = PREVIEW, color = Palette.primary)
            last != null -> Preview(last, group = conversation.members.size > 1)
        }
    }
    RowEnd(conversation, muted = muted, calling = calling)
}

/** The row's right side: the muted mark (0042) and the time over the unread count. */
@Composable
private fun RowEnd(
    conversation: Conversation,
    muted: Boolean,
    calling: Boolean,
) {
    val last = conversation.last
    Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            if (muted) {
                Icon(
                    AppIcons.BellOff,
                    contentDescription = stringResource(R.string.muted),
                    tint = Palette.mutedFg,
                    modifier = Modifier.size(MUTED_MARK.dp),
                )
            }
            last?.let {
                Text(
                    text = listStamp(it.ts),
                    style = STAMP,
                    color = if (calling) Palette.primary else Palette.mutedFg,
                )
            }
        }
        if (conversation.unread > 0u) UnreadBadge(conversation.unread.toInt(), muted)
    }
}

/**
 * The second line, and for the reader's own message its state (0043): a clock while it is on its way, the
 * failed mark, or who read it as the conversation says it (0022): "Lesin" in a 1:1, the count in a group.
 */
@Composable
private fun Preview(
    item: Item,
    group: Boolean,
) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        if (item.own && item.status == ItemStatus.PENDING) {
            Icon(
                AppIcons.Clock,
                contentDescription = stringResource(R.string.message_sending),
                tint = Palette.mutedFg,
                modifier = Modifier.size(STATE_MARK.dp),
            )
        }
        if (item.own && item.status == ItemStatus.FAILED) {
            Text(text = stringResource(R.string.message_failed), style = STAMP, color = Palette.danger)
        }
        Text(
            text = previewLine(item, group),
            style = PREVIEW,
            color = Palette.proseBody,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f, fill = false),
        )
        if (item.own && item.status == ItemStatus.SENT && item.readBy > 0u) {
            Text(text = "· ${readLine(item.readBy, group)}", style = PREVIEW, color = Palette.mutedFg, maxLines = 1)
        }
    }
}

/**
 * The newest item as the row's second line, said by whom: the reader ("Þú:"), or in a group the sender's
 * first name.
 */
@Composable
private fun previewLine(
    item: Item,
    group: Boolean,
): String {
    val line = lastLine(item, group)
    val said = item.content is Content.Text || item.content is Content.Media || item.content is Content.Post
    return when {
        !said -> line
        item.own -> stringResource(R.string.last_line_own, line)
        group -> stringResource(R.string.last_line_sender, item.sender.firstName(), line)
        else -> line
    }
}

/** The count of unread messages in a red pill, grey when muted; TalkBack reads the words. */
@Composable
private fun UnreadBadge(
    count: Int,
    muted: Boolean,
) {
    val description = pluralStringResource(R.plurals.unread_count, count, count)
    Box(
        modifier =
            Modifier
                .heightIn(min = PILL.dp)
                .widthIn(min = PILL.dp)
                .background(if (muted) Palette.muted else Palette.primary, CircleShape)
                .padding(horizontal = 6.dp)
                .clearAndSetSemantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) {
        Text(text = count.toString(), style = COUNT, color = if (muted) Palette.fg else Palette.primaryFg)
    }
}

private const val PILL = 20
private const val MUTED_MARK = 12
private const val STATE_MARK = 12

private val NAME = TextStyle(fontFamily = SansFamily, fontWeight = FontWeight.Black, fontSize = 14.5.sp)
private val PREVIEW = TextStyle(fontFamily = SansFamily, fontWeight = FontWeight.Medium, fontSize = 12.5.sp)
private val STAMP = TextStyle(fontFamily = SansFamily, fontWeight = FontWeight.Black, fontSize = 10.5.sp)
private val COUNT = TextStyle(fontFamily = SansFamily, fontWeight = FontWeight.Black, fontSize = 11.sp)
