package samtak.spjall.people

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.conversations.InviteHint
import samtak.spjall.core.Person
import samtak.spjall.ui.AVATAR_SIZE
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.Avatar
import samtak.spjall.ui.Palette
import samtak.spjall.ui.ProblemCard
import samtak.spjall.ui.VerifiedMark
import samtak.spjall.ui.shownName

/**
 * The people picker (new_conversation): a tap on a person opens the 1:1 with them; the new_group
 * row at the top switches to picking several for a group (decision 0043). The list ends above the
 * keyboard.
 */
@Composable
fun PeopleScreen(
    state: PeopleViewModel.State,
    actions: PeopleActions,
) {
    BackHandler(enabled = state.group, onBack = actions::single)
    Surface(modifier = Modifier.fillMaxSize()) {
        Column(modifier = Modifier.imePadding().safeDrawingPadding()) {
            Text(
                text = stringResource(if (state.group) R.string.new_group else R.string.new_conversation),
                style = MaterialTheme.typography.headlineMedium,
                modifier = Modifier.padding(16.dp),
            )
            SearchField(state.query, actions::search)
            if (state.busy || state.searching) {
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
            }
            state.problem?.let {
                Column(modifier = Modifier.padding(horizontal = 16.dp)) { ProblemCard(it, actions::retry) }
            }
            PeopleList(state, actions, Modifier.weight(1f))
            if (state.group && state.picked.isNotEmpty()) {
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
private fun SearchField(
    query: String,
    onSearch: (String) -> Unit,
) {
    // The picker is opened to find someone, so the keyboard is up at once.
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    OutlinedTextField(
        value = query,
        onValueChange = { if (it.length <= QUERY_LIMIT) onSearch(it) },
        placeholder = { Text(stringResource(R.string.people_search)) },
        leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
        singleLine = true,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).focusRequester(focus),
    )
}

/** The people met, then everyone else; a search lists only what it found, from the whole directory. */
@Composable
private fun PeopleList(
    state: PeopleViewModel.State,
    actions: PeopleActions,
    modifier: Modifier,
) {
    val met = if (state.query.isBlank()) state.people else emptyList()
    val everyone = state.everyone
    if (met.isEmpty() && everyone.isEmpty()) NoOne(state, actions)
    val headed = met.isNotEmpty() && everyone.isNotEmpty()
    val row: @Composable (Person) -> Unit = { ModeRow(it, state, actions) }
    LazyColumn(modifier = modifier) {
        if (!state.group) item(key = "new-group") { NewGroupRow(actions::group) }
        if (headed) item(key = "met") { Heading(R.string.people_met) }
        items(met, key = { "met-${it.account}" }) { row(it) }
        if (headed) item(key = "everyone") { Heading(R.string.people_everyone) }
        itemsIndexed(everyone, key = { _, person -> person.account }) { index, person ->
            if (index == everyone.lastIndex && state.next != null) LaunchedEffect(state.next) { actions.more() }
            row(person)
        }
    }
}

/** No one to show, once nothing is on its way: an invite, or that the search found no one. */
@Composable
private fun NoOne(
    state: PeopleViewModel.State,
    actions: PeopleActions,
) {
    val idle = state.loaded && !state.busy && !state.searching && state.problem == null
    if (!idle) return
    if (state.query.isBlank()) {
        InviteHint(stringResource(R.string.people_empty), actions::invite)
    } else {
        Text(
            text = stringResource(R.string.people_none_found),
            style = MaterialTheme.typography.bodyLarge,
            modifier = Modifier.padding(16.dp),
        )
    }
}

/** A person as the mode has it: a checkbox while picking several, otherwise a tap that opens the 1:1. */
@Composable
private fun ModeRow(
    person: Person,
    state: PeopleViewModel.State,
    actions: PeopleActions,
) {
    if (state.group) {
        PersonRow(person, picked = person.account in state.picked, onToggle = { actions.toggle(person.account) })
    } else {
        PersonRow(person, picked = null, onToggle = { actions.open(person.account) })
    }
}

@Composable
private fun Heading(text: Int) {
    Text(
        text = stringResource(text),
        style = MaterialTheme.typography.titleSmall,
        modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 4.dp).semantics { heading() },
    )
}

/** The way into picking several; the row's words are its label. */
@Composable
private fun NewGroupRow(onClick: () -> Unit) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = ROW_HEIGHT.dp)
                .clickable(role = Role.Button, onClick = onClick)
                .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            modifier =
                Modifier
                    .size(AVATAR_SIZE.dp)
                    .clip(CircleShape)
                    .background(Palette.primary),
            contentAlignment = Alignment.Center,
        ) {
            Icon(AppIcons.Plus, contentDescription = null, tint = Palette.primaryFg)
        }
        Text(
            text = stringResource(R.string.new_group),
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.weight(1f),
        )
    }
}

/** A person: a checkbox while picking several ([picked] not null), otherwise a tap that opens the 1:1. */
@Composable
private fun PersonRow(
    person: Person,
    picked: Boolean?,
    onToggle: () -> Unit,
) {
    val control =
        if (picked != null) {
            Modifier.toggleable(value = picked, role = Role.Checkbox, onValueChange = { onToggle() })
        } else {
            Modifier.clickable(role = Role.Button, onClick = onToggle)
        }
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = ROW_HEIGHT.dp)
                .then(control)
                .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Avatar(person)
        Row(
            modifier = Modifier.weight(1f),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                text = person.shownName(),
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.weight(1f, fill = false),
            )
            if (person.verified) VerifiedMark()
        }
        // The row is the control; the box only shows its state.
        if (picked != null) Checkbox(checked = picked, onCheckedChange = null)
    }
}

private const val ROW_HEIGHT = 64

/** The longest search the server takes (decision 0036). */
private const val QUERY_LIMIT = 100
