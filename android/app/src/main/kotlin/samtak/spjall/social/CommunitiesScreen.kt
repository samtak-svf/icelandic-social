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

/**
 * "Samfélög": the communities this account is in, then a search over the ones it may find. Hosted content
 * (decision 0060), so its own tab, cream ground and bordered cards, never the conversation list's rows.
 */
@Composable
fun CommunitiesScreen(
    state: CommunitiesViewModel.State,
    actions: CommunitiesActions,
) {
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
            Box(modifier = Modifier.weight(1f)) { Content(state, actions) }
        }
    }
}

@Composable
private fun Content(
    state: CommunitiesViewModel.State,
    actions: CommunitiesActions,
) {
    val others = state.others
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        state.problem?.let { problem -> item(key = "problem") { ProblemCard(problem) { actions.retry() } } }
        if (state.query.isBlank()) {
            item(key = "mine") { SectionLabel(stringResource(R.string.communities_mine)) }
            if (state.loaded && state.mine.isEmpty()) {
                item(
                    key = "mine-empty",
                ) { EmptyState(AppIcons.Communities, stringResource(R.string.communities_empty)) }
            }
            itemsIndexed(state.mine, key = { _, item -> "mine-${item.communityId}" }) { _, community ->
                CommunityRow(community) { actions.open(community.communityId) }
            }
        }
        item(key = "find") {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
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
        if (searched && others.isEmpty()) {
            item(key = "none") {
                Text(
                    text = stringResource(R.string.communities_none_found),
                    style = MaterialTheme.typography.bodyMedium,
                    color = Palette.mutedFg,
                )
            }
        }
        itemsIndexed(others, key = { _, item -> "found-${item.communityId}" }) { index, community ->
            CommunityRow(community) { actions.open(community.communityId) }
            if (index == others.lastIndex && state.next != null) LaunchedEffect(state.next) { actions.more() }
        }
    }
}

private const val NEW_BUTTON = 34
