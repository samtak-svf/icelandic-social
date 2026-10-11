package samtak.spjall.feed

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch
import samtak.spjall.brand.R
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.LocalReduceMotion
import samtak.spjall.ui.Palette
import samtak.spjall.ui.ProblemCard
import samtak.spjall.ui.Type
import samtak.spjall.ui.capitals
import samtak.spjall.ui.scrollTo

/**
 * Fljótið (the Fljotid artboard, decision 0034): the public feed every
 * account is in, newest first. The header says in one short line that it is
 * public, with a button for the whole sentence (0043); the pill above the
 * posts writes one. A pull refreshes it, and newer posts a refresh brings
 * while the reader is further down are offered by a pill that goes to the top.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FeedScreen(
    state: PostsViewModel.State,
    actions: PostsActions,
    posted: Flow<Unit>,
) {
    var composing by rememberSaveable { mutableStateOf(false) }
    val list = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val down by remember { derivedStateOf { list.firstVisibleItemIndex > 0 } }
    val reduce = LocalReduceMotion.current
    // Newer posts that land while the top is in view are seen where they land.
    LaunchedEffect(state.newer, down) { if (state.newer && !down) actions.seenNewer() }
    Surface(modifier = Modifier.fillMaxSize(), color = Palette.surface) {
        Column(modifier = Modifier.windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal))) {
            Header()
            PullToRefreshBox(
                isRefreshing = state.refreshing && state.loaded,
                onRefresh = actions::refresh,
                modifier = Modifier.fillMaxSize(),
            ) {
                LazyColumn(state = list, modifier = Modifier.fillMaxSize()) {
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
                    posts(state, actions, empty = R.string.feed_empty, emptyIcon = AppIcons.Waves, reduce = reduce)
                }
                if (state.newer && down) {
                    NewPostsPill(
                        onClick = {
                            actions.seenNewer()
                            scope.launch { list.scrollTo(0, reduce) }
                        },
                        modifier = Modifier.align(Alignment.TopCenter).padding(top = 8.dp),
                    )
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

/**
 * The cream band: the tab's name in capitals over the short line that says
 * the feed is public, never hidden (0034), and its button for the full sentence.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Header() {
    var more by rememberSaveable { mutableStateOf(false) }
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
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = stringResource(R.string.feed_public_short),
                style = MaterialTheme.typography.bodySmall,
                color = Palette.mutedFg,
                modifier = Modifier.weight(1f, fill = false),
            )
            IconButton(onClick = { more = true }) {
                Icon(
                    AppIcons.Info,
                    contentDescription = stringResource(R.string.feed_public_more),
                    tint = Palette.mutedFg,
                    modifier = Modifier.size(INFO.dp),
                )
            }
        }
    }
    if (more) {
        ModalBottomSheet(onDismissRequest = { more = false }, containerColor = Palette.surface) {
            Text(
                text = stringResource(R.string.feed_public_notice),
                style = Type.bubble,
                color = Palette.fg,
                modifier = Modifier.padding(start = 24.dp, end = 24.dp, bottom = 32.dp),
            )
        }
    }
}

/** "Nýjar færslur": over the list while newer posts wait above; a tap goes to the top. */
@Composable
private fun NewPostsPill(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Button(
        onClick = onClick,
        shape = RoundedCornerShape(PILL_RADIUS.dp),
        modifier = modifier.heightIn(min = PILL.dp),
    ) { Text(stringResource(R.string.feed_new_posts)) }
}

private const val INFO = 18
private const val PILL = 48
private const val PILL_RADIUS = 24
