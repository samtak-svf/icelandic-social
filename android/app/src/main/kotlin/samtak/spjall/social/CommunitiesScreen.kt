package samtak.spjall.social

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.EmptyState
import samtak.spjall.ui.Palette
import samtak.spjall.ui.ProblemCard
import samtak.spjall.ui.RoundButton
import samtak.spjall.ui.ScreenHeader
import samtak.spjall.ui.SectionLabel

/** The combined feed, communities this account belongs to, and communities it may discover. */
@Composable
fun CommunitiesScreen(
    state: CommunitiesViewModel.State,
    actions: CommunitiesActions,
) {
    var reporting by rememberSaveable { mutableStateOf<String?>(null) }
    Surface(modifier = Modifier.fillMaxSize(), color = Palette.bg, contentColor = Palette.fg) {
        Column(modifier = Modifier.windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal))) {
            ScreenHeader(stringResource(R.string.tab_communities)) {
                if (state.verified) {
                    RoundButton(
                        icon = AppIcons.Plus,
                        description = stringResource(R.string.community_create),
                        onClick = actions::create,
                        fill = Palette.primary,
                        tint = Palette.primaryFg,
                        size = NEW_BUTTON.dp,
                    )
                }
            }
            if (state.busy || state.searching) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            Box(modifier = Modifier.weight(1f)) { Content(state, actions) { reporting = it } }
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
private fun Content(
    state: CommunitiesViewModel.State,
    actions: CommunitiesActions,
    onReport: (String) -> Unit,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item(key = "tabs") {
            Choices(
                options =
                    listOf(
                        CommunitiesTab.FEED to stringResource(R.string.communities_tab_feed),
                        CommunitiesTab.MINE to stringResource(R.string.communities_tab_mine),
                        CommunitiesTab.DISCOVER to stringResource(R.string.communities_tab_discover),
                    ),
                selected = state.tab,
                onSelect = actions::selectTab,
            )
        }
        state.problem?.let { problem -> item(key = "problem") { ProblemCard(problem) { actions.retry() } } }
        when (state.tab) {
            CommunitiesTab.FEED -> feed(state, actions, onReport)
            CommunitiesTab.MINE -> mine(state, actions)
            CommunitiesTab.DISCOVER -> discover(state, actions)
        }
    }
}

private fun androidx.compose.foundation.lazy.LazyListScope.feed(
    state: CommunitiesViewModel.State,
    actions: CommunitiesActions,
    onReport: (String) -> Unit,
) {
    if (state.loaded && state.feed.isEmpty()) {
        item(key = "feed-empty") { EmptyState(AppIcons.Communities, stringResource(R.string.communities_feed_empty)) }
    }
    itemsIndexed(state.feed, key = { _, post -> "feed-${post.postId}" }) { index, post ->
        val communityName = state.mine.firstOrNull { it.communityId == post.communityId }?.name
        if (communityName != null) {
            Text(
                text = communityName,
                style = MaterialTheme.typography.labelLarge,
                color = Palette.mutedFg,
                modifier = Modifier.padding(start = 4.dp),
            )
        }
        PostCard(
            post = post,
            reacting = post.postId in state.reacting,
            reported = post.postId in state.reported,
            onReact = { actions.react(post.postId, it) },
            onReport = { onReport(post.postId) },
            onOpen = { actions.openPost(post.postId) },
        )
        if (index == state.feed.lastIndex && state.feedNext != null) {
            LaunchedEffect(state.feedNext) { actions.moreFeed() }
        }
    }
}

private fun androidx.compose.foundation.lazy.LazyListScope.mine(
    state: CommunitiesViewModel.State,
    actions: CommunitiesActions,
) {
    item(key = "mine-title") { SectionLabel(stringResource(R.string.communities_mine)) }
    if (state.loaded && state.mine.isEmpty()) {
        item(key = "mine-empty") { EmptyState(AppIcons.Communities, stringResource(R.string.communities_empty)) }
    }
    itemsIndexed(state.mine, key = { _, community -> "mine-${community.communityId}" }) { _, community ->
        CommunityRow(community) { actions.open(community.communityId) }
    }
}

private fun androidx.compose.foundation.lazy.LazyListScope.discover(
    state: CommunitiesViewModel.State,
    actions: CommunitiesActions,
) {
    item(key = "discover-search") {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            SectionLabel(stringResource(R.string.communities_find))
            OutlinedTextField(
                value = state.query,
                onValueChange = actions::search,
                placeholder = { Text(stringResource(R.string.communities_find)) },
                leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
    val searched = state.loaded && !state.searching && state.query.isNotBlank()
    if (searched && state.others.isEmpty()) {
        item(key = "discover-none") {
            Text(
                text = stringResource(R.string.communities_none_found),
                style = MaterialTheme.typography.bodyMedium,
                color = Palette.mutedFg,
            )
        }
    }
    itemsIndexed(state.others, key = { _, community -> "found-${community.communityId}" }) { index, community ->
        CommunityRow(community) { actions.open(community.communityId) }
        if (index == state.others.lastIndex && state.next != null) {
            LaunchedEffect(state.next) { actions.more() }
        }
    }
}

private const val NEW_BUTTON = 34
