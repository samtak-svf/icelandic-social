package samtak.spjall.social

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.Author
import samtak.spjall.core.CommunityInvitation
import samtak.spjall.core.JoinRequest
import samtak.spjall.ui.Palette
import samtak.spjall.ui.ProblemCard

/** The accounts waiting to join a private community, each with the two answers (#354). */
@Composable
fun JoinRequestsScreen(
    state: JoinRequestsViewModel.State,
    actions: JoinRequestsActions,
) {
    Surface(modifier = Modifier.fillMaxSize(), color = Palette.bg, contentColor = Palette.fg) {
        Column(modifier = Modifier.windowInsetsPadding(WindowInsets.safeDrawing.only(SUB_SCREEN_SIDES))) {
            SubHeader(stringResource(R.string.join_requests_title), actions::back)
            JoinRequestsBody(state, actions, Modifier.weight(1f))
        }
    }
}

/** The waiting accounts with the two answers, without a screen around them: Stjórna's detail pane draws it too. */
@Composable
internal fun JoinRequestsBody(
    state: JoinRequestsViewModel.State,
    actions: JoinRequestsActions,
    modifier: Modifier = Modifier,
) {
    Column(modifier) {
        if (state.busy) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
        LazyColumn(
            modifier = Modifier.weight(1f),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            state.problem?.let { problem -> item(key = "problem") { ProblemCard(problem) { actions.retry() } } }
            if (state.loaded && state.problem == null && state.nothingWaits) {
                item(key = "empty") { Muted(stringResource(R.string.join_requests_empty)) }
            }
            items(state.requests, key = { it.accountId }) { request ->
                RequestCard(request, enabled = !state.busy, actions = actions)
            }
            invitationItems(state, actions)
        }
    }
}

@Composable
private fun RequestCard(
    request: JoinRequest,
    enabled: Boolean,
    actions: JoinRequestsActions,
) {
    SocialCard {
        Byline(Author(request.accountId, request.name, request.verified), request.requestedAt)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = { actions.approve(request.accountId) },
                enabled = enabled,
                modifier = Modifier.heightIn(min = 44.dp),
            ) { Text(stringResource(R.string.join_request_approve)) }
            OutlinedButton(
                onClick = { actions.decline(request.accountId) },
                enabled = enabled,
                colors = ButtonDefaults.outlinedButtonColors(contentColor = Palette.danger),
                modifier = Modifier.heightIn(min = 44.dp),
            ) { Text(stringResource(R.string.join_request_decline)) }
        }
    }
}

/** The invitations that wait, under their own heading; nothing at all when there are none (0130). */
private fun LazyListScope.invitationItems(
    state: JoinRequestsViewModel.State,
    actions: JoinRequestsActions,
) {
    if (state.invitations.isEmpty()) return
    item(key = "invitations-heading") {
        Text(stringResource(R.string.community_invitations_pending), style = MaterialTheme.typography.titleMedium)
    }
    items(state.invitations, key = { "invitation-${it.accountId}" }) { invitation ->
        InvitationCard(invitation, enabled = !state.busy, actions = actions)
    }
}

@Composable
private fun InvitationCard(
    invitation: CommunityInvitation,
    enabled: Boolean,
    actions: JoinRequestsActions,
) {
    SocialCard {
        Text(
            invitation.name ?: stringResource(R.string.person_unnamed),
            style = MaterialTheme.typography.titleSmall,
        )
        invitation.invitedBy?.let {
            Muted(
                stringResource(R.string.community_invitation_from, it.name ?: stringResource(R.string.person_deleted)),
            )
        }
        OutlinedButton(
            onClick = { actions.withdraw(invitation.accountId) },
            enabled = enabled,
            modifier = Modifier.heightIn(min = 44.dp),
        ) { Text(stringResource(R.string.community_withdraw_invite)) }
    }
}
