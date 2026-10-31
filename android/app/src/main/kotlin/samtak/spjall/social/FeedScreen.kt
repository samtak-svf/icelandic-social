package samtak.spjall.social

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
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
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Surface
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.EmptyState
import samtak.spjall.ui.Palette
import samtak.spjall.ui.ProblemCard
import samtak.spjall.ui.ScreenHeader

/** The test tags of the feed's list and its progress (the composer's are in `FeedComposerSheet.kt`). */
internal const val FEED_LIST = "feed-list"
internal const val FEED_PROGRESS = "feed-progress"

/** The first tab (decision 0116): a prompt that opens the composer, then the posts of friends and communities. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FeedScreen(
    state: FeedViewModel.State,
    attached: Attached,
    actions: FeedActions,
) {
    var reporting by rememberSaveable { mutableStateOf<String?>(null) }
    var composing by rememberSaveable { mutableStateOf(false) }
    // The sheet closes once a post it sent is in; a refusal or a dismissal keeps it, and the draft, as it was.
    var sent by remember { mutableStateOf(false) }
    LaunchedEffect(state.publishing) {
        if (state.publishing) {
            sent = true
        } else if (sent) {
            sent = false
            if (state.draft.isEmpty()) composing = false
        }
    }
    // Nothing held while a cursor remains: the screen goes on asking, a go at a time, until a post or the end comes.
    LaunchedEffect(state.next, state.loading, state.problem) {
        if (state.keepsAsking) actions.more()
    }
    val now = System.currentTimeMillis()
    Surface(modifier = Modifier.fillMaxSize(), color = Palette.bg, contentColor = Palette.fg) {
        Column(modifier = Modifier.windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal))) {
            ScreenHeader(stringResource(R.string.tab_feed))
            SuspendedNotice()
            PullToRefreshBox(
                isRefreshing = state.refreshing,
                onRefresh = actions::refresh,
                modifier = Modifier.weight(1f),
            ) {
                LazyColumn(
                    modifier = Modifier.fillMaxSize().testTag(FEED_LIST),
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    item(key = "composer") { ComposePrompt { composing = true } }
                    state.problem?.let { problem -> item(key = "problem") { ProblemCard(problem, actions::retry) } }
                    when (state.phase) {
                        FeedPhase.LOADING -> item(key = "loading") { Progress() }
                        FeedPhase.PROBLEM -> Unit
                        FeedPhase.EMPTY ->
                            item(key = "empty") { EmptyState(AppIcons.Feed, stringResource(R.string.feed_empty)) }
                        FeedPhase.LIST -> posts(state, actions, now) { reporting = it }
                    }
                }
            }
        }
    }
    if (composing) FeedComposerSheet(state, attached, actions) { composing = false }
    reporting?.let { postId ->
        ReportDialog(
            onSend = { reason, note ->
                actions.report(postId, reason, note)
                reporting = null
            },
            onDismiss = { reporting = null },
        )
    }
}

@Composable
private fun Progress() {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
        CircularProgressIndicator(modifier = Modifier.testTag(FEED_PROGRESS))
    }
}

private fun LazyListScope.posts(
    state: FeedViewModel.State,
    actions: FeedActions,
    now: Long,
    onReport: (String) -> Unit,
) {
    items(state.posts, key = { it.postId }) { post ->
        PostCard(
            post = post,
            // A post this account may not write on (muted, say) is read: the like button waits as if busy.
            reacting = post.postId in state.reacting || !state.writes(post, now),
            reported = post.postId in state.reported,
            callbacks =
                PostCardCallbacks(
                    onReact = { actions.react(post.postId, it) },
                    onReport = { onReport(post.postId) },
                    onOpen = { actions.openPost(post.postId) },
                    onComment = { actions.comment(post.postId) },
                    onDelete = { actions.deletePost(post.postId) }.takeIf { post.mine },
                    // A wall post's card is always unavailable to its recipient (decision 0115): it is not sent.
                    onSendToConversation =
                        { actions.sendToConversation(post.postId) }.takeIf { post.wallOwner == null },
                    poll =
                        actions.callbacksFor(post.postId, state.canClose(post)).takeIf { state.writes(post, now) },
                    answering = post.postId in state.answering,
                ),
            community = state.community(post),
        )
        if (post.postId == state.posts.last().postId && state.next != null) {
            LaunchedEffect(state.next, state.problem) { if (state.problem == null) actions.more() }
        }
    }
    if (state.next != null && state.problem == null) item(key = "more") { Progress() }
}
