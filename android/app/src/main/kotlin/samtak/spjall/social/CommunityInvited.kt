package samtak.spjall.social

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.Community

/**
 * A moderator invited this account (decision 0130): who did, when the community says so, and the two answers.
 * Accepting is the join call, which an invitation admits at once; declining takes the invitation away.
 */
@Composable
internal fun InvitedPart(
    community: Community,
    state: CommunityViewModel.State,
    actions: CommunityActions,
) {
    val inviter = community.invitedBy
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Muted(
            if (inviter == null) {
                stringResource(R.string.community_invited)
            } else {
                stringResource(R.string.community_invited_by, inviter.name ?: stringResource(R.string.person_deleted))
            },
        )
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = actions::join,
                enabled = !state.busy && !suspended(),
                modifier = Modifier.heightIn(min = 44.dp),
            ) { Text(stringResource(R.string.community_accept_invite)) }
            OutlinedButton(
                onClick = actions::withdraw,
                enabled = !state.busy,
                modifier = Modifier.heightIn(min = 44.dp),
            ) { Text(stringResource(R.string.community_decline_invite)) }
        }
    }
}
