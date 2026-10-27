package samtak.spjall.social

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.SocialNotification
import samtak.spjall.core.SocialNotificationKind
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.EmptyState
import samtak.spjall.ui.Palette
import samtak.spjall.ui.ProblemCard
import samtak.spjall.ui.ScreenHeader
import samtak.spjall.ui.listStamp

/**
 * "Tilkynningar": comments and reactions on this account's posts, an approved join request, and a moderator's
 * action, newest first. One not read before this list showed it carries a dot.
 */
@Composable
fun NotificationsScreen(
    state: NotificationsViewModel.State,
    actions: NotificationsActions,
) {
    Surface(modifier = Modifier.fillMaxSize(), color = Palette.bg, contentColor = Palette.fg) {
        Column(modifier = Modifier.windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal))) {
            ScreenHeader(stringResource(R.string.tab_notifications))
            if (state.busy && !state.loaded) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            Box(modifier = Modifier.weight(1f)) {
                if (state.loaded && state.problem == null && state.notifications.isEmpty()) {
                    EmptyState(AppIcons.Bell, stringResource(R.string.notifications_empty))
                }
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    state.problem?.let { problem -> item(key = "problem") { ProblemCard(problem) { actions.retry() } } }
                    itemsIndexed(state.notifications, key = { _, item -> item.notificationId }) { index, notification ->
                        NotificationRow(notification) { actions.open(notification) }
                        if (index == state.notifications.lastIndex && state.next != null) {
                            LaunchedEffect(state.next) { actions.more() }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun NotificationRow(
    notification: SocialNotification,
    onOpen: () -> Unit,
) {
    SocialCard(modifier = Modifier.clickable(role = Role.Button, onClick = onOpen)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (!notification.read) {
                Box(modifier = Modifier.size(DOT.dp).clip(CircleShape).background(Palette.primary))
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(text = notification.sentence(), style = MaterialTheme.typography.bodyLarge)
                Text(
                    text = listStamp(notification.createdAt),
                    style = MaterialTheme.typography.bodySmall,
                    color = Palette.mutedFg,
                )
            }
        }
    }
}

@Composable
private fun SocialNotification.sentence(): String =
    when (kind) {
        SocialNotificationKind.COMMENT -> stringResource(R.string.notice_comment, actor.shownName())
        SocialNotificationKind.REPLY -> stringResource(R.string.notice_reply, actor.shownName())
        SocialNotificationKind.REACTION ->
            // The emoji the account reacted with leads the sentence (0100); an old server sends none.
            listOfNotNull(emoji, stringResource(R.string.notice_reaction, actor.shownName())).joinToString(" ")
        SocialNotificationKind.JOIN_APPROVED -> stringResource(R.string.notice_join_approved)
        SocialNotificationKind.MODERATED -> stringResource(R.string.notice_moderated)
    }

private const val DOT = 8
