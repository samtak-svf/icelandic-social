package samtak.spjall.conversations

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import samtak.spjall.brand.R
import samtak.spjall.core.Content
import samtak.spjall.core.Conversation
import samtak.spjall.core.Item
import samtak.spjall.core.ItemStatus
import samtak.spjall.core.Mute
import samtak.spjall.socket.Connection
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.Avatar
import samtak.spjall.ui.NotificationsOff
import samtak.spjall.ui.Palette
import samtak.spjall.ui.ProblemCard
import samtak.spjall.ui.RoundButton
import samtak.spjall.ui.SansFamily
import samtak.spjall.ui.Type
import samtak.spjall.ui.VerifiedMark
import samtak.spjall.ui.avatarKind
import samtak.spjall.ui.capitals
import samtak.spjall.ui.firstName
import samtak.spjall.ui.lastLine
import samtak.spjall.ui.listStamp
import samtak.spjall.ui.photoOf
import samtak.spjall.ui.title

/**
 * The conversation list (1a): dense rows, newest first, as the core orders them. While the system blocks
 * the app's notifications, a notice above the rows says so, since nothing else would. A search under the
 * header shows the conversations it found, then the people ("Fólk") from the directory.
 */
@Composable
fun ConversationsScreen(
    state: ConversationsViewModel.State,
    actions: ConversationsActions,
    notificationsOff: Boolean = false,
) {
    Surface(modifier = Modifier.fillMaxSize(), color = Palette.surface) {
        Column(modifier = Modifier.windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal))) {
            Header(actions::newConversation)
            SearchField(state.query, actions::search)
            if (state.searching) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            ConnectionLine(state.connection)
            if (state.problem != null || state.inviteExpired || notificationsOff) {
                Column(
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    state.problem?.let { ProblemCard(it, actions::retry) }
                    if (state.inviteExpired) Notice(stringResource(R.string.link_expired))
                    if (notificationsOff) NotificationsOff(actions::notificationSettings)
                }
            }
            if (state.nothingFound) {
                NoneFound()
            } else if (!state.searched && state.loaded && state.conversations.isEmpty()) {
                // Everyone signed in is in the picker (decisions 0036, 0043): people can be found, not only invited.
                InviteHint(stringResource(R.string.conversations_empty), actions::invite, actions::newConversation)
            }
            LazyColumn(modifier = Modifier.fillMaxSize()) {
                if (state.searched) {
                    state.found?.let { results(it, actions) }
                } else {
                    conversationRows(state.conversations, actions)
                }
            }
        }
    }
}

internal fun LazyListScope.conversationRows(
    conversations: List<Conversation>,
    actions: ConversationsActions,
) {
    items(conversations, key = { it.id }) { conversation ->
        ConversationRow(conversation, onOpen = { actions.open(conversation.id) })
        HorizontalDivider(color = Palette.border)
    }
}

/** The cream band: the tab's name in capitals, and a round button for a new conversation. */
@Composable
private fun Header(onNew: () -> Unit) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .background(Palette.bg)
                .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top))
                .padding(start = 20.dp, end = 8.dp, top = 4.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = stringResource(R.string.tab_conversations).capitals(),
            style = Type.screenTitle,
            color = Palette.fg,
            modifier = Modifier.weight(1f).semantics { heading() },
        )
        RoundButton(
            icon = AppIcons.Plus,
            description = stringResource(R.string.new_conversation),
            onClick = onNew,
            fill = Palette.primary,
            tint = Palette.primaryFg,
            size = NEW_BUTTON.dp,
        )
    }
}

/** Shown only while the socket is not open (decision 0022). */
@Composable
private fun ConnectionLine(connection: Connection) {
    val text =
        when (connection) {
            Connection.Online -> return
            Connection.Connecting -> stringResource(R.string.connection_connecting)
            Connection.Offline -> stringResource(R.string.connection_offline)
        }
    Text(
        text = text,
        style = MaterialTheme.typography.bodySmall,
        color = Palette.mutedFg,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 6.dp),
    )
}

@Composable
private fun ConversationRow(
    conversation: Conversation,
    onOpen: () -> Unit,
) {
    val title = conversation.title()
    val last = conversation.last
    val unread = conversation.unread > 0u
    // A mute silences, it does not hide (0042): the count stays, in the muted colour, and nothing calls out.
    val muted = conversation.mute != Mute.Off
    val calling = unread && !muted
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .background(if (calling) Palette.primarySubtle else Color.Transparent)
                .clickable(onClick = onOpen)
                .padding(horizontal = 20.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
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
            last?.let {
                Text(
                    text = previewLine(it, group = conversation.members.size > 1),
                    style = PREVIEW,
                    color = Palette.proseBody,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        RowEnd(conversation, muted = muted, calling = calling)
    }
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
                if (it.status == ItemStatus.FAILED) {
                    Text(text = stringResource(R.string.message_failed), style = STAMP, color = Palette.danger)
                } else {
                    Text(
                        text = listStamp(it.ts),
                        style = STAMP,
                        color = if (calling) Palette.primary else Palette.mutedFg,
                    )
                }
            }
        }
        if (conversation.unread > 0u) UnreadBadge(conversation.unread.toInt(), muted)
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

/** The empty list and the empty picker point at the invite link (decision 0022); the list also at the picker. */
@Composable
fun InviteHint(
    text: String,
    onInvite: () -> Unit,
    onFindPeople: (() -> Unit)? = null,
) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(text = text, style = MaterialTheme.typography.bodyLarge, color = Palette.fg)
        // Side by side, and one under the other when a large font leaves no room.
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Button(onClick = onInvite) { Text(stringResource(R.string.invite)) }
            onFindPeople?.let { OutlinedButton(onClick = it) { Text(stringResource(R.string.find_people)) } }
        }
    }
}

@Composable
private fun Notice(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.bodyMedium,
        color = Palette.fg,
        modifier =
            Modifier
                .fillMaxWidth()
                .background(Palette.secondarySubtle, RoundedCornerShape(NOTICE_RADIUS.dp))
                .padding(horizontal = 14.dp, vertical = 13.dp),
    )
}

private const val NEW_BUTTON = 34
private const val PILL = 20
private const val MUTED_MARK = 12
private const val NOTICE_RADIUS = 14

private val NAME = TextStyle(fontFamily = SansFamily, fontWeight = FontWeight.Black, fontSize = 14.5.sp)
private val PREVIEW = TextStyle(fontFamily = SansFamily, fontWeight = FontWeight.Medium, fontSize = 12.5.sp)
private val STAMP = TextStyle(fontFamily = SansFamily, fontWeight = FontWeight.Black, fontSize = 10.5.sp)
private val COUNT = TextStyle(fontFamily = SansFamily, fontWeight = FontWeight.Black, fontSize = 11.sp)
