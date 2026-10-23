package samtak.spjall.me.link

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.LinkRequest
import samtak.spjall.me.Pill

/**
 * The second half (decisions 0064, 0077): which browser asks, how much history it gets, the approval, the
 * wait while the phone seals and uploads that history, and the word that it is done.
 */
@Composable
fun LinkApproveScreen(
    state: LinkViewModel.State,
    actions: LinkActions,
) {
    LinkFrame(title = R.string.device_link_approve_title, onBack = actions::back) {
        when (state) {
            is LinkViewModel.State.Approve -> Choice(state, actions)
            is LinkViewModel.State.Sending -> Sending(state.history)
            LinkViewModel.State.Done ->
                Text(stringResource(R.string.device_link_done), style = MaterialTheme.typography.bodyLarge)
            else -> Unit
        }
    }
}

@Composable
private fun Choice(
    state: LinkViewModel.State.Approve,
    actions: LinkActions,
) {
    Text(
        text = stringResource(R.string.device_link_approve_body, state.request.label()),
        style = MaterialTheme.typography.bodyLarge,
    )
    Text(
        text = stringResource(R.string.device_link_history_title),
        style = MaterialTheme.typography.titleMedium,
        modifier = Modifier.semantics { heading() },
    )
    Column(modifier = Modifier.selectableGroup()) {
        HISTORY.forEach { (history, text) ->
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = ROW.dp)
                        .selectable(
                            selected = state.history == history,
                            onClick = { actions.choose(history) },
                            role = Role.RadioButton,
                        ),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                RadioButton(selected = state.history == history, onClick = null)
                Text(stringResource(text), style = MaterialTheme.typography.bodyLarge)
            }
        }
    }
    Pill(
        text = stringResource(R.string.device_link_approve),
        filled = true,
        onClick = actions::approve,
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
    )
}

@Composable
private fun Sending(history: LinkViewModel.History) {
    Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
    if (history != LinkViewModel.History.NONE) {
        Text(stringResource(R.string.device_link_sending_history), style = MaterialTheme.typography.bodyLarge)
    }
}

/** The browser as the server named it, "Firefox á Linux"; what it did not name is left out (0064). */
@Composable
private fun LinkRequest.label(): String {
    val browser = browser
    val os = os
    return when {
        browser != null && os != null -> stringResource(R.string.session_browser, browser, os)
        else -> browser ?: os ?: stringResource(R.string.session_browser_unknown)
    }
}

private val HISTORY =
    listOf(
        LinkViewModel.History.RECENT to R.string.device_link_history_recent,
        LinkViewModel.History.ALL to R.string.device_link_history_all,
        LinkViewModel.History.NONE to R.string.device_link_history_none,
    )

private const val ROW = 48
