package samtak.spjall.social

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.SocialNotification
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.EmptyState
import samtak.spjall.ui.Palette
import samtak.spjall.ui.ProblemCard
import samtak.spjall.ui.ScreenHeader

/**
 * "Tilkynningar": comments, replies and reactions on this account's posts, an approved join request, and a
 * moderator's action, newest first, the ones made since the list was last seen under "new" (0104).
 */
@Composable
fun NotificationsScreen(
    state: NotificationsViewModel.State,
    actions: NotificationsActions,
) {
    Surface(modifier = Modifier.fillMaxSize(), color = Palette.bg, contentColor = Palette.fg) {
        Column(modifier = Modifier.windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal))) {
            ScreenHeader(stringResource(R.string.notifications_title)) {
                if (state.notifications.any { !it.read }) {
                    IconButton(onClick = actions::markAllRead) {
                        Icon(AppIcons.Check, contentDescription = stringResource(R.string.notifications_mark_all_read))
                    }
                }
            }
            if (state.busy && !state.loaded) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            Box(modifier = Modifier.weight(1f)) {
                if (state.loaded && state.problem == null && state.notifications.isEmpty()) {
                    EmptyState(AppIcons.Bell, stringResource(R.string.notifications_empty))
                }
                val (new, earlier) = state.sections
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    state.problem?.let { problem -> item(key = "problem") { ProblemCard(problem) { actions.retry() } } }
                    section(R.string.notice_section_new, new, state, actions)
                    section(R.string.notice_section_earlier, earlier, state, actions)
                    if (state.next != null) item(key = "more") { LaunchedEffect(state.next) { actions.more() } }
                }
            }
        }
    }
}

/** A heading and its rows; nothing at all when there are none. */
private fun LazyListScope.section(
    @StringRes title: Int,
    rows: List<SocialNotification>,
    state: NotificationsViewModel.State,
    actions: NotificationsActions,
) {
    if (rows.isEmpty()) return
    item(key = "section-$title") {
        Text(
            text = stringResource(title),
            style = MaterialTheme.typography.titleSmall,
            color = Palette.mutedFg,
            modifier = Modifier.semantics { heading() },
        )
    }
    items(rows, key = { it.notificationId }) { NoticeRow(it, it.communityId?.let(state.communities::get), actions) }
}
