package samtak.spjall.social

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.FilterChip
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.FriendRequest
import samtak.spjall.core.FriendSort
import samtak.spjall.ui.Palette
import samtak.spjall.ui.ProblemCard
import samtak.spjall.ui.SectionLabel
import samtak.spjall.ui.calendarDate

/**
 * The friends of this account, the requests in and out and the people it snoozed (decision 0114), in the order the
 * web page has them: requests to answer, the friends with a search and a sort, the requests sent, the snoozes.
 */
@Composable
fun FriendsScreen(
    state: FriendsViewModel.State,
    actions: FriendsActions,
) {
    Surface(modifier = Modifier.fillMaxSize(), color = Palette.bg, contentColor = Palette.fg) {
        Column(modifier = Modifier.windowInsetsPadding(WindowInsets.safeDrawing.only(SUB_SCREEN_SIDES))) {
            SubHeader(stringResource(R.string.person_friends), actions::back)
            SuspendedNotice()
            if (state.busy) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            FriendsList(state, actions, Modifier.weight(1f))
        }
    }
}

@Composable
private fun FriendsList(
    state: FriendsViewModel.State,
    actions: FriendsActions,
    modifier: Modifier,
) {
    LazyColumn(
        modifier = modifier.testTag("friends-list"),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        state.problem?.let { problem -> item(key = "problem") { ProblemCard(problem) { actions.retry() } } }
        if (state.incoming.isNotEmpty()) {
            item(key = "incoming-label") { SectionLabel(stringResource(R.string.friends_incoming)) }
            items(state.incoming, key = { "in-" + it.person.accountId }) { IncomingRow(it, !state.busy, actions) }
        }
        item(key = "count") { FriendsHeader(state, actions) }
        if (state.loaded && state.problem == null && state.friends.isEmpty()) {
            item(key = "empty") {
                Muted(
                    stringResource(
                        if (state.query.isEmpty()) R.string.friends_empty else R.string.friends_search_empty,
                    ),
                )
            }
        }
        items(state.friends, key = { "f-" + it.person.accountId }) { friend ->
            PersonRow(
                person = friend.person,
                detail = stringResource(R.string.person_friends_since, calendarDate(friend.since)),
                onOpen = { actions.open(friend.person.accountId) },
            )
        }
        if (state.sent.isNotEmpty()) {
            item(key = "sent-label") { SectionLabel(stringResource(R.string.friends_sent)) }
            items(state.sent, key = { "out-" + it.person.accountId }) { SentRow(it, !state.busy, actions) }
        }
        if (state.snoozes.isNotEmpty()) {
            item(key = "snoozed-label") { SectionLabel(stringResource(R.string.friends_snoozed)) }
            items(state.snoozes, key = { "z-" + it.person.accountId }) { snooze ->
                PersonRow(
                    person = snooze.person,
                    detail = stringResource(R.string.person_snoozed_until, calendarDate(snooze.until)),
                    onOpen = { actions.open(snooze.person.accountId) },
                ) {
                    RowButton(R.string.person_unsnooze, !state.busy) { actions.unsnooze(snooze.person.accountId) }
                }
            }
        }
    }
}

/** How many friends there are, the search field and the two sorts. */
@Composable
private fun FriendsHeader(
    state: FriendsViewModel.State,
    actions: FriendsActions,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            text = pluralStringResource(R.plurals.person_friend_count, state.count.toInt(), state.count.toLong()),
            style = androidx.compose.material3.MaterialTheme.typography.titleSmall,
        )
        OutlinedTextField(
            value = state.typed,
            onValueChange = actions::query,
            singleLine = true,
            placeholder = { Text(stringResource(R.string.people_search)) },
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            modifier = Modifier.fillMaxWidth().testTag("friends-search"),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SortChip(R.string.friends_sort_newest, state.sort == FriendSort.NEWEST) { actions.sort(FriendSort.NEWEST) }
            SortChip(R.string.friends_sort_name, state.sort == FriendSort.NAME) { actions.sort(FriendSort.NAME) }
        }
    }
}

@Composable
private fun SortChip(
    label: Int,
    selected: Boolean,
    onClick: () -> Unit,
) {
    FilterChip(selected = selected, onClick = onClick, label = { Text(stringResource(label)) })
}

@Composable
private fun IncomingRow(
    request: FriendRequest,
    enabled: Boolean,
    actions: FriendsActions,
) {
    val id = request.person.accountId
    SocialCard {
        PersonRow(request.person, null, onOpen = { actions.open(id) })
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            androidx.compose.material3.Button(
                onClick = { actions.accept(id) },
                enabled = enabled,
                modifier = Modifier.heightIn(min = 44.dp),
            ) { Text(stringResource(R.string.person_accept)) }
            OutlinedButton(
                onClick = { actions.decline(id) },
                enabled = enabled,
                modifier = Modifier.heightIn(min = 44.dp),
            ) { Text(stringResource(R.string.person_decline)) }
        }
    }
}

@Composable
private fun SentRow(
    request: FriendRequest,
    enabled: Boolean,
    actions: FriendsActions,
) {
    PersonRow(request.person, null, onOpen = { actions.open(request.person.accountId) }) {
        RowButton(R.string.person_cancel_request, enabled) { actions.cancel(request.person.accountId) }
    }
}

@Composable
internal fun RowButton(
    label: Int,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    TextButton(onClick = onClick, enabled = enabled, modifier = Modifier.heightIn(min = 44.dp)) {
        Text(stringResource(label))
    }
}
