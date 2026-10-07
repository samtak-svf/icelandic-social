package samtak.spjall.people

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.conversations.InviteHint
import samtak.spjall.core.Person
import samtak.spjall.ui.Avatar
import samtak.spjall.ui.ProblemCard
import samtak.spjall.ui.VerifiedMark
import samtak.spjall.ui.shownName

/** Pick one person for a 1:1, or more for a group. */
@Composable
fun PeopleScreen(
    state: PeopleViewModel.State,
    actions: PeopleActions,
) {
    Surface(modifier = Modifier.fillMaxSize()) {
        Column(modifier = Modifier.safeDrawingPadding()) {
            Text(
                text = stringResource(if (state.picked.size > 1) R.string.new_group else R.string.new_conversation),
                style = MaterialTheme.typography.headlineMedium,
                modifier = Modifier.padding(16.dp),
            )
            if (state.busy) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            state.problem?.let {
                Column(modifier = Modifier.padding(horizontal = 16.dp)) { ProblemCard(it, actions::retry) }
            }
            if (state.loaded && state.people.isEmpty() && state.problem == null) {
                InviteHint(stringResource(R.string.people_empty), actions::invite)
            }
            LazyColumn(modifier = Modifier.weight(1f)) {
                items(state.people, key = { it.account }) { person ->
                    PersonRow(
                        person,
                        picked = person.account in state.picked,
                        onToggle = { actions.toggle(person.account) },
                    )
                }
            }
            if (state.picked.isNotEmpty()) {
                Button(
                    onClick = actions::start,
                    enabled = !state.busy,
                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                ) { Text(stringResource(R.string.contact_action)) }
            }
        }
    }
}

@Composable
private fun PersonRow(
    person: Person,
    picked: Boolean,
    onToggle: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = ROW_HEIGHT.dp)
                .toggleable(value = picked, role = Role.Checkbox, onValueChange = { onToggle() })
                .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Avatar(person.name)
        Text(
            text = person.shownName(),
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.weight(1f, fill = false),
        )
        if (person.verified) VerifiedMark()
        Row(modifier = Modifier.weight(1f), horizontalArrangement = Arrangement.End) {
            // The row is the control; the box only shows its state.
            Checkbox(checked = picked, onCheckedChange = null)
        }
    }
}

private const val ROW_HEIGHT = 64
