package samtak.spjall.feed

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.flow.Flow
import samtak.spjall.brand.R
import samtak.spjall.ui.Palette
import samtak.spjall.ui.ProblemCard
import samtak.spjall.ui.Type
import samtak.spjall.ui.capitals

/**
 * Fljótið (the Fljotid artboard, decision 0034): the public feed every
 * account is in, newest first. The header says in one line that it is
 * public; the pill above the posts writes one. A pull refreshes it.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FeedScreen(
    state: PostsViewModel.State,
    actions: PostsActions,
    posted: Flow<Unit>,
) {
    var composing by rememberSaveable { mutableStateOf(false) }
    Surface(modifier = Modifier.fillMaxSize(), color = Palette.surface) {
        Column(modifier = Modifier.windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal))) {
            Header()
            PullToRefreshBox(
                isRefreshing = state.refreshing && state.loaded,
                onRefresh = actions::refresh,
                modifier = Modifier.fillMaxSize(),
            ) {
                LazyColumn(modifier = Modifier.fillMaxSize()) {
                    item(key = "compose") {
                        ComposePill(
                            stringResource(R.string.feed_composer_placeholder),
                            onClick = { composing = true },
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                        )
                    }
                    state.problem?.let {
                        item(key = "problem") {
                            Box(modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) {
                                ProblemCard(it, actions::refresh)
                            }
                        }
                    }
                    posts(state, actions, empty = R.string.feed_empty)
                }
            }
        }
    }
    if (composing) {
        ComposerSheet(
            placeholder = stringResource(R.string.feed_composer_placeholder),
            busy = state.posting,
            posted = posted,
            onPost = actions::post,
            onDismiss = { composing = false },
        )
    }
}

/** The cream band: the tab's name in capitals over the line that says the feed is public. */
@Composable
private fun Header() {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .background(Palette.bg)
                .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top))
                .padding(start = 20.dp, end = 20.dp, top = 4.dp, bottom = 10.dp),
    ) {
        Text(
            text = stringResource(R.string.tab_feed).capitals(),
            style = Type.screenTitle,
            color = Palette.fg,
            modifier = Modifier.semantics { heading() },
        )
        Text(
            text = stringResource(R.string.feed_public_notice),
            style = MaterialTheme.typography.bodySmall,
            color = Palette.mutedFg,
        )
    }
}
