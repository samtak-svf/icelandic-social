package samtak.spjall.me.link

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import samtak.spjall.AppGraph
import samtak.spjall.ui.rememberBack

/** A browser's link code, scanned or pasted, then approved with a choice of history (decisions 0064, 0077). */
@Composable
internal fun LinkRoute(
    nav: NavController,
    graph: AppGraph,
) {
    val link: LinkViewModel = viewModel(key = "link") { LinkViewModel(graph.account) }
    val state by link.state.collectAsStateWithLifecycle()
    val pop = rememberBack(nav)
    val actions =
        object : LinkActions {
            override fun back() = if (state == LinkViewModel.State.Pasting) link.scan() else pop()

            override fun paste() = link.paste()

            override fun submit(text: String) = link.submit(text)

            override fun again() = link.again()

            override fun retry() = link.retry()

            override fun choose(history: LinkViewModel.History) = link.choose(history)

            override fun approve() = link.approve()
        }
    when (state) {
        is LinkViewModel.State.Approve, is LinkViewModel.State.Sending, LinkViewModel.State.Done ->
            LinkApproveScreen(state, actions)
        else -> LinkScanScreen(state, actions)
    }
}
