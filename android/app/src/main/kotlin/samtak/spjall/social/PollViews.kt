package samtak.spjall.social

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.Poll
import samtak.spjall.core.PollOption
import samtak.spjall.ui.Palette

/** The test tags of a poll card, of its option rows (suffixed with the index) and of its footer actions. */
internal const val POLL_CARD = "poll-card"
internal const val POLL_OPTION = "poll-option"
internal const val POLL_WITHDRAW = "poll-withdraw"
internal const val POLL_CLOSE = "poll-close"

// The poll (decision 0090) and the anonymous switches (0091), as the web's poll.tsx, poll-fields.tsx and composer.

/** Whether the core sent the counts, which it does only where the reader may see them. */
internal fun Poll.showsResults(): Boolean = options.all { it.votes != null }

/** A whole percentage of [part] in [total]; 0 for an empty poll. */
internal fun share(
    part: Long,
    total: Long,
): Int = if (total == 0L) 0 else Math.round(part * PERCENT / total.toDouble()).toInt()

/** What a poll card can do; a null callback is something the reader may not do. */
class PollCallbacks(
    val onVote: (String) -> Unit,
    val onWithdraw: () -> Unit,
    /** Closes the poll; offered to its author and the moderators. */
    val onClose: (() -> Unit)?,
)

/** A poll on a post card: the options as choices with a bar when the counts came, the total, withdraw and close. */
@Composable
internal fun PollCard(
    poll: Poll,
    busy: Boolean,
    callbacks: PollCallbacks?,
) {
    val results = poll.showsResults()
    val open = !poll.closed
    Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.testTag(POLL_CARD)) {
        poll.options.forEachIndexed { index, option ->
            PollOptionRow(option, index, poll, results, enabled = callbacks != null && !busy && open, callbacks)
        }
        PollFooter(poll, busy, callbacks)
    }
}

@Composable
private fun PollOptionRow(
    option: PollOption,
    index: Int,
    poll: Poll,
    results: Boolean,
    enabled: Boolean,
    callbacks: PollCallbacks?,
) {
    val mine = poll.mine == option.optionId
    val percent = share((option.votes ?: 0uL).toLong(), poll.total.toLong())
    val yours = stringResource(R.string.poll_your_choice)
    Box(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = 44.dp)
                .testTag("$POLL_OPTION-$index")
                .border(
                    BorderStroke(if (mine) 2.dp else 1.dp, if (mine) Palette.primary else Palette.border),
                    RoundedCornerShape(8.dp),
                ).selectable(selected = mine, enabled = enabled && !mine, role = Role.RadioButton) {
                    callbacks?.onVote?.invoke(option.optionId)
                }.semantics { if (mine) contentDescription = "${option.text}, $yours" },
    ) {
        if (results) {
            Box(
                Modifier
                    .fillMaxHeight()
                    .fillMaxWidth(percent / PERCENT.toFloat())
                    .background(Palette.primarySubtle, RoundedCornerShape(8.dp)),
            )
        }
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(
                text = if (mine) "${option.text} \u2713" else option.text,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = if (mine) FontWeight.SemiBold else FontWeight.Normal,
                modifier = Modifier.weight(1f),
            )
            if (results) Text("${option.votes} \u00B7 $percent %", style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable
private fun PollFooter(
    poll: Poll,
    busy: Boolean,
    callbacks: PollCallbacks?,
) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
        val total = poll.total.toInt()
        val count = pluralStringResource(R.plurals.poll_votes, total, total)
        Text(
            text = if (poll.closed) "$count \u00B7 ${stringResource(R.string.poll_closed)}" else count,
            style = MaterialTheme.typography.bodyMedium,
            color = Palette.mutedFg,
            modifier = Modifier.weight(1f),
        )
        if (callbacks != null && !poll.closed) {
            if (poll.mine != null) {
                TextButton(
                    onClick = callbacks.onWithdraw,
                    enabled = !busy,
                    modifier = Modifier.testTag(POLL_WITHDRAW),
                ) {
                    Text(stringResource(R.string.poll_withdraw))
                }
            }
            callbacks.onClose?.let { close ->
                TextButton(onClick = close, enabled = !busy, modifier = Modifier.testTag(POLL_CLOSE)) {
                    Text(stringResource(R.string.poll_close))
                }
            }
        }
    }
}

/** The option fields of the poll being written: two to six, each at most [PollDraft.OPTION_MAX] characters. */
@Composable
internal fun PollFields(
    options: List<String>,
    actions: CommunityActions,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEachIndexed { index, text ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = text,
                    onValueChange = { actions.pollOption(index, it) },
                    label = { Text(stringResource(R.string.composer_poll_option, index + 1)) },
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                )
                if (options.size > PollDraft.MIN_OPTIONS) {
                    TextButton(onClick = { actions.removePollOption(index) }) {
                        Text(stringResource(R.string.composer_poll_remove_option))
                    }
                }
            }
        }
        if (options.size < PollDraft.MAX_OPTIONS) {
            OutlinedButton(onClick = actions::addPollOption, modifier = Modifier.heightIn(min = 44.dp)) {
                Text(stringResource(R.string.composer_poll_add_option))
            }
        }
    }
}

/** A labelled switch with its hint under it. */
@Composable
private fun HintedSwitch(
    label: String,
    hint: String,
    checked: Boolean,
    enabled: Boolean,
    onChange: (Boolean) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = 48.dp)
                    .toggleable(value = checked, enabled = enabled, role = Role.Switch, onValueChange = onChange),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
            Switch(checked = checked, onCheckedChange = null, enabled = enabled)
        }
        Text(hint, style = MaterialTheme.typography.bodySmall, color = Palette.mutedFg)
    }
}

/** The composer's switch: this post goes without the author's name (0091). */
@Composable
internal fun AnonymousSwitch(
    checked: Boolean,
    enabled: Boolean,
    onChange: (Boolean) -> Unit,
) = HintedSwitch(
    stringResource(R.string.composer_anonymous),
    stringResource(R.string.composer_anonymous_hint),
    checked,
    enabled,
    onChange,
)

/** The owner's switch in the edit screen: members may post without their name (0091). */
@Composable
internal fun AnonymousPostsSwitch(
    checked: Boolean,
    busy: Boolean,
    onChange: (Boolean) -> Unit,
) = HintedSwitch(
    stringResource(R.string.community_anonymous_posts),
    stringResource(R.string.community_anonymous_posts_hint),
    checked,
    !busy,
    onChange,
)

private const val PERCENT = 100
