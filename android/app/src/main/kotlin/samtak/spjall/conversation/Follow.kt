package samtak.spjall.conversation

import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow

/**
 * While the bottom is in view it stays there, also when the newest row grows
 * as its photo decodes (0048). Only a scroll that ends decides, so a row that
 * grows does not count as reading further up.
 */
@Composable
internal fun FollowGrowth(list: LazyListState) {
    var pinned by remember { mutableStateOf(true) }
    LaunchedEffect(list) {
        snapshotFlow { list.isScrollInProgress }.collect { scrolling ->
            if (!scrolling) pinned = list.atBottom()
        }
    }
    LaunchedEffect(list) {
        snapshotFlow {
            list.layoutInfo.visibleItemsInfo
                .firstOrNull()
                ?.let { it.key to it.size }
        }.collect { if (pinned && !list.isScrollInProgress && !list.atBottom()) list.scrollToItem(0) }
    }
}

private fun LazyListState.atBottom() = firstVisibleItemIndex == 0 && firstVisibleItemScrollOffset == 0
