package samtak.spjall.social

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.PostTarget
import samtak.spjall.core.WallAudience
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.EmptyState
import samtak.spjall.ui.Palette
import samtak.spjall.ui.ProblemCard
import samtak.spjall.ui.ScreenHeader

/** The test tags of the feed: its list, its composer, its progress, and a target chip is `feed-target-<id>`. */
internal const val FEED_LIST = "feed-list"
internal const val FEED_COMPOSER = "feed-composer"
internal const val FEED_PROGRESS = "feed-progress"
internal const val FEED_WALL_TARGET = "feed-target-wall"

/** The first tab (decision 0116): the composer, then the posts of friends and communities, newest first. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FeedScreen(
    state: FeedViewModel.State,
    attached: Attached,
    actions: FeedActions,
) {
    var reporting by rememberSaveable { mutableStateOf<String?>(null) }
    // Nothing held while a cursor remains: the screen goes on asking, a go at a time, until a post or the end comes.
    LaunchedEffect(state.next, state.loading, state.problem) {
        if (state.keepsAsking) actions.more()
    }
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
                    item(key = "composer") { FeedComposer(state, attached, actions) }
                    state.problem?.let { problem -> item(key = "problem") { ProblemCard(problem, actions::retry) } }
                    when (state.phase) {
                        FeedPhase.LOADING -> item(key = "loading") { Progress() }
                        FeedPhase.PROBLEM -> Unit
                        FeedPhase.EMPTY ->
                            item(key = "empty") { EmptyState(AppIcons.Feed, stringResource(R.string.feed_empty)) }
                        FeedPhase.LIST -> posts(state, actions) { reporting = it }
                    }
                }
            }
        }
    }
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
    onReport: (String) -> Unit,
) {
    items(state.posts, key = { it.postId }) { post ->
        PostCard(
            post = post,
            reacting = post.postId in state.reacting,
            reported = post.postId in state.reported,
            callbacks =
                PostCardCallbacks(
                    onReact = { actions.react(post.postId, it) },
                    onReport = { onReport(post.postId) },
                    onOpen = { actions.openPost(post.postId) },
                    onComment = { actions.comment(post.postId) },
                    onDelete = { actions.deletePost(post.postId) }.takeIf { post.mine },
                    onSendToConversation = { actions.sendToConversation(post.postId) },
                    poll = actions.callbacksFor(post.postId, mayClose = post.mine),
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

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun FeedComposer(
    state: FeedViewModel.State,
    attached: Attached,
    actions: FeedActions,
) {
    SocialCard {
        Composer(
            label = stringResource(R.string.post_compose_prompt),
            action = stringResource(R.string.post_publish),
            text = state.draft,
            sending = state.publishing,
            onText = actions::draft,
            onSend = actions::publish,
            modifier = Modifier.testTag(FEED_COMPOSER),
            ready = attached.postable(state.draft),
        ) {
            val off = state.publishing || suspended()
            ComposerAttachments(attached.picked, attached.poll, attached.notice, off, actions)
            Text(stringResource(R.string.feed_compose_target), style = MaterialTheme.typography.labelMedium)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val target = state.target
                FilterChip(
                    selected = target is PostTarget.Wall,
                    onClick = { if (target !is PostTarget.Wall) actions.audience(WallAudience.FRIENDS) },
                    label = { Text(stringResource(R.string.feed_target_wall)) },
                    modifier = Modifier.heightIn(min = 48.dp).testTag(FEED_WALL_TARGET),
                )
                state.communities.forEach { community ->
                    FilterChip(
                        selected = (target as? PostTarget.Community)?.communityId == community.communityId,
                        onClick = { actions.target(PostTarget.Community(community.communityId, anonymous = false)) },
                        label = { Text(community.name) },
                        modifier = Modifier.heightIn(min = 48.dp).testTag("feed-target-${community.communityId}"),
                    )
                }
            }
            when (val target = state.target) {
                is PostTarget.Wall -> {
                    AudienceChips(target.audience, actions::audience)
                    Muted(stringResource(R.string.wall_not_encrypted_notice))
                }
                is PostTarget.Community -> {
                    val chosen = state.communities.firstOrNull { it.communityId == target.communityId }
                    if (chosen?.anonymousPosts == true) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Switch(
                                checked = target.anonymous,
                                onCheckedChange = actions::anonymous,
                                modifier = Modifier.testTag("feed-anonymous"),
                            )
                            Text(
                                stringResource(R.string.composer_anonymous),
                                style = MaterialTheme.typography.bodyMedium,
                            )
                        }
                    }
                }
            }
        }
    }
}
