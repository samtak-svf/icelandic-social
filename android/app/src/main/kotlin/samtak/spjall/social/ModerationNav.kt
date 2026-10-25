package samtak.spjall.social

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import samtak.spjall.core.Report
import samtak.spjall.core.ReportState
import samtak.spjall.ui.rememberBack

// Stjórna's join requests and report queue, each as its own screen (a compact or medium window) and as a pane inside
// the community (an expanded window, decision 0087), over one view model and one set of actions.

/**
 * Stjórna's join requests inside the community (an expanded window), over its own view model in the community's
 * entry.
 */
@Composable
internal fun JoinRequestsPane(
    communityId: String,
    social: Social,
) {
    val model: JoinRequestsViewModel =
        viewModel(key = "requests-$communityId") { JoinRequestsViewModel(communityId, social) }
    val state by model.state.collectAsStateWithLifecycle()
    JoinRequestsBody(state, joinRequestsActions(model) { })
}

private fun joinRequestsActions(
    model: JoinRequestsViewModel,
    back: () -> Unit,
) = object : JoinRequestsActions {
    override fun back() = back()

    override fun approve(accountId: String) = model.approve(accountId)

    override fun decline(accountId: String) = model.decline(accountId)

    override fun retry() = model.retry()
}

@Composable
internal fun JoinRequests(
    communityId: String,
    social: Social,
    nav: NavController,
) {
    val model: JoinRequestsViewModel =
        viewModel(key = "requests-$communityId") { JoinRequestsViewModel(communityId, social) }
    val state by model.state.collectAsStateWithLifecycle()
    val back = rememberBack(nav)
    JoinRequestsScreen(state, joinRequestsActions(model, back))
}

/**
 * Stjórna's report queue inside the community (an expanded window), over its own view model in the community's
 * entry.
 */
@Composable
internal fun ReportsPane(
    communityId: String,
    social: Social,
) {
    val model: ReportsViewModel = viewModel(key = "reports-$communityId") { ReportsViewModel(communityId, social) }
    val state by model.state.collectAsStateWithLifecycle()
    ReportsBody(state, reportsActions(model) { })
}

private fun reportsActions(
    model: ReportsViewModel,
    back: () -> Unit,
) = object : ReportsActions {
    override fun back() = back()

    override fun show(state: ReportState) = model.show(state)

    override fun reason(
        reportId: String,
        text: String,
    ) = model.reason(reportId, text)

    override fun act(
        report: Report,
        verb: ReportsViewModel.Verb,
    ) = model.act(report, verb)

    override fun mute(
        report: Report,
        period: ReportsViewModel.MutePeriod,
    ) = model.act(report, ReportsViewModel.Verb.Mute, period)

    override fun revealAuthor(postId: String) = model.revealAuthor(postId)

    override fun retry() = model.retry()
}

@Composable
internal fun Reports(
    communityId: String,
    social: Social,
    nav: NavController,
) {
    val model: ReportsViewModel = viewModel(key = "reports-$communityId") { ReportsViewModel(communityId, social) }
    val state by model.state.collectAsStateWithLifecycle()
    val back = rememberBack(nav)
    ReportsScreen(state, reportsActions(model, back))
}
