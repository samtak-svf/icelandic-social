package samtak.spjall.conversation

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import samtak.spjall.AppGraph
import samtak.spjall.core.Item
import samtak.spjall.core.MuteFor
import samtak.spjall.ui.AppRoutes
import samtak.spjall.ui.rememberBack

/**
 * A conversation's information (decision 0055), on the conversation's own view model: it sits
 * under this screen on the back stack, so both show the same state and a photo fetched in one is
 * there in the other.
 */
@Composable
internal fun ConversationInfoRoute(
    id: String,
    nav: NavController,
    graph: AppGraph,
) {
    val context = LocalContext.current
    val owner = remember { nav.previousBackStackEntry } ?: return
    val model: ConversationViewModel =
        viewModel(viewModelStoreOwner = owner, key = "conversation-$id") {
            ConversationViewModel(id, graph.account, graph.socket, graph.drafts)
        }
    val state by model.state.collectAsStateWithLifecycle()
    LaunchedEffect(model) { model.loadShared() }
    LaunchedEffect(model) { model.opened.collect { openFile(context, graph.files, it) } }
    val pop = rememberBack(nav)
    // Made a master off the main thread, in the view model; the core then makes the group's square (0094).
    val groupPhoto =
        rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
            uri?.let { model.setGroupPhoto { graph.files.master(it) } }
        }
    ConversationInfoScreen(
        state,
        object : ConversationInfoActions {
            override fun back() = pop()

            override fun timer(seconds: UInt?) = model.timer(seconds)

            override fun mute(duration: MuteFor) = model.mute(duration)

            override fun unmute() = model.unmute()

            override fun block() = model.block()

            override fun add() = nav.navigate("${AppRoutes.PEOPLE}/$id")

            override fun rename(name: String?) = model.rename(name)

            override fun setPhoto() =
                groupPhoto.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))

            override fun clearPhoto() = model.clearGroupPhoto()

            override fun remove(account: String) = model.remove(account)

            override fun leave() = model.leave()

            override fun fetch(item: Item) = model.fetch(item)

            override fun open(item: Item) = model.open(item)

            override fun more() = model.moreShared()

            override fun retry() = model.retry()
        },
    )
}
