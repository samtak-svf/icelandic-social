package samtak.spjall.conversations

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import samtak.spjall.brand.R
import samtak.spjall.core.Person
import samtak.spjall.ui.Avatar
import samtak.spjall.ui.Palette
import samtak.spjall.ui.SansFamily
import samtak.spjall.ui.VerifiedMark
import samtak.spjall.ui.shownName

// The search on the conversation list (decisions 0036 and 0038): the field under the header and what it found.

/** What a search found: the conversations first, then the people under their own heading. */
internal fun LazyListScope.results(
    found: ConversationsViewModel.Found,
    typing: Set<String>,
    actions: ConversationsActions,
    reduce: Boolean,
) {
    conversationRows(found.conversations, typing, actions, reduce)
    if (found.people.isEmpty()) return
    item(key = "people") {
        Text(
            text = stringResource(R.string.conversations_people),
            style = MaterialTheme.typography.titleSmall,
            color = Palette.fg,
            modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 4.dp).semantics { heading() },
        )
    }
    items(found.people, key = { "person-${it.account}" }) { person ->
        PersonRow(person, onOpen = { actions.openPerson(person.account) })
        HorizontalDivider(color = Palette.border)
    }
}

/** The name search under the header (decision 0038). */
@Composable
internal fun SearchField(
    query: String,
    onSearch: (String) -> Unit,
) {
    OutlinedTextField(
        value = query,
        onValueChange = { if (it.length <= QUERY_LIMIT) onSearch(it) },
        placeholder = { Text(stringResource(R.string.conversations_search)) },
        leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
        singleLine = true,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
    )
}

@Composable
private fun PersonRow(
    person: Person,
    onOpen: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clickable(onClick = onOpen)
                .padding(horizontal = 20.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Avatar(person)
        Text(
            text = person.shownName(),
            style = PERSON_NAME,
            color = Palette.fg,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f, fill = false),
        )
        if (person.verified) VerifiedMark()
    }
}

/** A search that found neither a conversation nor a person. */
@Composable
internal fun NoneFound() {
    Text(
        text = stringResource(R.string.conversations_none_found),
        style = MaterialTheme.typography.bodyLarge,
        color = Palette.fg,
        modifier = Modifier.padding(horizontal = 20.dp, vertical = 16.dp),
    )
}

/** The longest search the server and the core take (decision 0036). */
private const val QUERY_LIMIT = 100

private val PERSON_NAME = TextStyle(fontFamily = SansFamily, fontWeight = FontWeight.Black, fontSize = 14.5.sp)
