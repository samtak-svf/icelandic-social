package samtak.spjall.conversations

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.Conversation
import samtak.spjall.socket.Connection
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.EmptyState
import samtak.spjall.ui.LocalReduceMotion
import samtak.spjall.ui.NotificationsOff
import samtak.spjall.ui.Palette
import samtak.spjall.ui.PlaceholderKind
import samtak.spjall.ui.PlaceholderRows
import samtak.spjall.ui.ProblemCard
import samtak.spjall.ui.RoundButton
import samtak.spjall.ui.Type
import samtak.spjall.ui.capitals
import samtak.spjall.ui.rowMotion

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
            Rows(state, actions)
        }
    }
}

/** The rows, or what stands in for them: grey rows until the first read, then the empty state. */
@Composable
private fun Rows(
    state: ConversationsViewModel.State,
    actions: ConversationsActions,
) {
    if (state.nothingFound) {
        NoneFound()
    } else if (!state.searched && state.loaded && state.conversations.isEmpty()) {
        // Everyone signed in is in the picker (decisions 0036, 0043): people can be found, not only invited.
        EmptyState(
            AppIcons.Chat,
            stringResource(R.string.conversations_empty),
            action = stringResource(R.string.invite),
            onAction = actions::invite,
            secondary = stringResource(R.string.find_people),
            onSecondary = actions::newConversation,
        )
    }
    val reduce = LocalReduceMotion.current
    LazyColumn(modifier = Modifier.fillMaxSize()) {
        if (state.placeholders) {
            item(key = "placeholders") { PlaceholderRows(PlaceholderKind.Conversation) }
        } else if (state.searched) {
            state.found?.let { results(it, state.typing, actions, reduce) }
        } else {
            conversationRows(state.conversations, state.typing, actions, reduce)
        }
    }
}

internal fun LazyListScope.conversationRows(
    conversations: List<Conversation>,
    typing: Set<String>,
    actions: ConversationsActions,
    reduce: Boolean,
) {
    items(conversations, key = { it.id }) { conversation ->
        Column(modifier = Modifier.rowMotion(this, reduce)) {
            ConversationRow(conversation, typing = conversation.id in typing, actions)
            HorizontalDivider(color = Palette.border)
        }
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
private const val NOTICE_RADIUS = 14
