package samtak.spjall.conversations

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.Badge
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.Conversation
import samtak.spjall.core.ItemStatus
import samtak.spjall.socket.Connection
import samtak.spjall.ui.Avatar
import samtak.spjall.ui.ProblemCard
import samtak.spjall.ui.VerifiedMark
import samtak.spjall.ui.lastLine
import samtak.spjall.ui.shortTime
import samtak.spjall.ui.title

/** The conversation list (1a): dense rows, newest first, as the core orders them. */
@Composable
fun ConversationsScreen(
    state: ConversationsViewModel.State,
    actions: ConversationsActions,
) {
    Surface(modifier = Modifier.fillMaxSize()) {
        Column(modifier = Modifier.safeDrawingPadding()) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = stringResource(R.string.tab_conversations),
                    style = MaterialTheme.typography.headlineMedium,
                    modifier = Modifier.weight(1f),
                )
                TextButton(onClick = actions::newConversation) {
                    Icon(Icons.Filled.Add, contentDescription = null)
                    Text(stringResource(R.string.new_conversation))
                }
            }
            ConnectionLine(state.connection)
            Column(modifier = Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                state.problem?.let { ProblemCard(it, actions::retry) }
                if (state.inviteExpired) Notice(stringResource(R.string.link_expired))
            }
            if (state.loaded && state.conversations.isEmpty()) {
                InviteHint(stringResource(R.string.conversations_empty), actions::invite)
            }
            LazyColumn(modifier = Modifier.fillMaxSize()) {
                items(state.conversations, key = { it.id }) { conversation ->
                    ConversationRow(conversation, onOpen = { actions.open(conversation.id) })
                    HorizontalDivider(modifier = Modifier.padding(start = ROW_INSET.dp))
                }
            }
        }
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
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
    )
}

@Composable
private fun ConversationRow(
    conversation: Conversation,
    onOpen: () -> Unit,
) {
    val title = conversation.title()
    val last = conversation.last
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = ROW_HEIGHT.dp)
                .clickable(onClick = onOpen)
                .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Avatar(conversation.members.firstOrNull()?.name)
        Column(modifier = Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = if (conversation.unread > 0u) FontWeight.Bold else null,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                // One member's mark: a group's title names several people.
                if (conversation.members.size == 1 && conversation.members.single().verified) VerifiedMark()
            }
            last?.let {
                Text(
                    text = lastLine(it, group = conversation.members.size > 1),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            last?.let {
                if (it.status == ItemStatus.FAILED) {
                    Text(
                        text = stringResource(R.string.message_failed),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.error,
                    )
                } else {
                    Text(
                        text = shortTime(it.ts),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            if (conversation.unread > 0u) UnreadBadge(conversation.unread.toInt())
        }
    }
}

@Composable
private fun UnreadBadge(count: Int) {
    val description = pluralStringResource(R.plurals.unread_count, count, count)
    Badge(
        containerColor = MaterialTheme.colorScheme.primary,
        contentColor = MaterialTheme.colorScheme.onPrimary,
        modifier = Modifier.clearAndSetSemantics { contentDescription = description },
    ) { Text(count.toString()) }
}

/** The empty list and the empty picker point at the invite link (decision 0022). */
@Composable
fun InviteHint(
    text: String,
    onInvite: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(text = text, style = MaterialTheme.typography.bodyLarge)
        Button(onClick = onInvite) { Text(stringResource(R.string.invite)) }
    }
}

@Composable
private fun Notice(text: String) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Text(text = text, color = MaterialTheme.colorScheme.onSurface, modifier = Modifier.padding(16.dp))
    }
}

private const val ROW_HEIGHT = 72
private const val ROW_INSET = 76
