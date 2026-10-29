package samtak.spjall.people

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import samtak.spjall.AppGraph
import samtak.spjall.ui.AppRoutes
import samtak.spjall.ui.conversationRoute
import samtak.spjall.ui.openTab
import samtak.spjall.ui.rememberBack

/** Who to talk to: one person, or several for a group, or, with [targetConversation], who to add to a group. */
@Composable
internal fun PeopleRoute(
    nav: NavController,
    graph: AppGraph,
    targetConversation: String? = null,
) {
    val people: PeopleViewModel =
        viewModel(key = "people-${targetConversation ?: "new"}") {
            PeopleViewModel(graph.account, graph.socket, targetConversation = targetConversation)
        }
    val state by people.state.collectAsStateWithLifecycle()
    LaunchedEffect(people) {
        people.opened.collect {
            if (targetConversation == null) {
                nav.navigate(conversationRoute(it)) { popUpTo(AppRoutes.LIST) }
            } else {
                // Back to the information, whose own read then shows the new members (0078).
                nav.popBackStack()
            }
        }
    }
    val pop = rememberBack(nav)
    PeopleScreen(
        state,
        object : PeopleActions {
            override fun open(account: String) = people.open(account)

            override fun group() = people.group()

            override fun single() = people.single()

            override fun back() = pop()

            override fun toggle(account: String) = people.toggle(account)

            override fun start() = people.start()

            override fun search(text: String) = people.search(text)

            override fun more() = people.more()

            override fun invite() = nav.openTab(AppRoutes.ME)

            override fun retry() = people.retry()
        },
    )
}
