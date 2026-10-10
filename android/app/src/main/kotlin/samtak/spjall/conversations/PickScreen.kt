package samtak.spjall.conversations

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.Conversation
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.Avatar
import samtak.spjall.ui.Palette
import samtak.spjall.ui.ProblemCard
import samtak.spjall.ui.VerifiedMark
import samtak.spjall.ui.avatarKind
import samtak.spjall.ui.title

/**
 * The conversation list in pick mode: each row a checkbox, and one send for all the picked ones.
 * A forward (decision 0041) and a shared post (decision 0040) differ only in [title] and what the
 * model does per conversation.
 */
@Composable
fun PickScreen(
    title: String,
    state: PickViewModel.State,
    actions: PickActions,
) {
    Surface(modifier = Modifier.fillMaxSize(), color = Palette.surface) {
        Column(modifier = Modifier.windowInsetsPadding(WindowInsets.safeDrawing)) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(start = 4.dp, end = 16.dp, top = 2.dp, bottom = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                IconButton(onClick = actions::back) {
                    Icon(AppIcons.Back, contentDescription = stringResource(R.string.back), tint = Palette.fg)
                }
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleLarge,
                    color = Palette.fg,
                    modifier = Modifier.semantics { heading() },
                )
            }
            if (state.sending) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            state.problem?.let {
                Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                    ProblemCard(it, actions::retry)
                }
            }
            if (state.loaded && state.conversations.isEmpty() && state.problem == null) {
                Text(
                    text = stringResource(R.string.pick_empty),
                    style = MaterialTheme.typography.bodyLarge,
                    modifier = Modifier.padding(16.dp),
                )
            }
            LazyColumn(modifier = Modifier.weight(1f)) {
                items(state.conversations, key = { it.id }) { conversation ->
                    PickRow(conversation, picked = conversation.id in state.picked) { actions.toggle(conversation.id) }
                    HorizontalDivider(color = Palette.border)
                }
            }
            Button(
                onClick = actions::send,
                enabled = state.canSend,
                modifier = Modifier.fillMaxWidth().padding(16.dp),
            ) { Text(stringResource(R.string.send)) }
        }
    }
}

@Composable
private fun PickRow(
    conversation: Conversation,
    picked: Boolean,
    onToggle: () -> Unit,
) {
    val title = conversation.title()
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = ROW_HEIGHT.dp)
                .toggleable(value = picked, role = Role.Checkbox, onValueChange = { onToggle() })
                .padding(horizontal = 20.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // As in the list: a group's circle carries the group's initials, a 1:1's the other person's.
        val initialsOf = if (conversation.members.size > 1) title else conversation.members.firstOrNull()?.name
        Avatar(initialsOf, kind = conversation.avatarKind())
        Row(
            modifier = Modifier.weight(1f),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium,
                color = Palette.fg,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false),
            )
            if (conversation.members.size == 1 && conversation.members.single().verified) VerifiedMark()
        }
        // The row is the control; the box only shows its state.
        Checkbox(checked = picked, onCheckedChange = null)
    }
}

private const val ROW_HEIGHT = 64
