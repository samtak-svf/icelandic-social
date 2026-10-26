package samtak.spjall.conversations

import android.widget.Toast
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import samtak.spjall.AppGraph
import samtak.spjall.brand.R
import samtak.spjall.core.Body
import samtak.spjall.ui.rememberBack

/** Copies one message into the conversations picked (decision 0041), then back to where it came from. */
@Composable
internal fun ForwardRoute(
    from: String,
    seq: ULong,
    nav: NavController,
    graph: AppGraph,
) {
    val model: PickViewModel =
        viewModel(key = "forward-$from-$seq") {
            PickViewModel(graph.account, graph.socket, except = from, preview = forwarding(from, seq)) { to ->
                forward(from, seq, to)
            }
        }
    PickRoute(stringResource(R.string.forward), R.plurals.forward_done, model, nav)
}

/** Sends a community post into the conversations picked (0080), then back to where it was shared from. */
@Composable
internal fun SharePostRoute(
    postId: String,
    nav: NavController,
    graph: AppGraph,
) {
    val model: PickViewModel =
        viewModel(key = "share-$postId") {
            PickViewModel(graph.account, graph.socket, preview = { Outgoing.Post(postId) }) { to ->
                send(to, Body.Post(postId))
            }
        }
    PickRoute(stringResource(R.string.post_share_to_conversation), R.plurals.post_share_done, model, nav)
}

/** The conversation picker; once every picked conversation has its copy, says how many and goes back. */
@Composable
private fun PickRoute(
    title: String,
    done: Int,
    model: PickViewModel,
    nav: NavController,
) {
    val state by model.state.collectAsStateWithLifecycle()
    val pop = rememberBack(nav)
    val context = LocalContext.current
    val resources = LocalResources.current
    LaunchedEffect(model) {
        model.done.collect { count ->
            Toast
                .makeText(
                    context,
                    resources.getQuantityString(done, count, count),
                    Toast.LENGTH_SHORT,
                ).show()
            nav.popBackStack()
        }
    }
    PickScreen(
        title,
        state,
        object : PickActions {
            override fun toggle(conversation: String) = model.toggle(conversation)

            override fun send() = model.send()

            override fun search(text: String) = model.search(text)

            override fun back() = pop()

            override fun retry() = model.retry()
        },
    )
}
