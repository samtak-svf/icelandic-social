package samtak.spjall.conversation

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.Item
import samtak.spjall.core.Person
import samtak.spjall.ui.Avatar
import samtak.spjall.ui.NameWithMark
import samtak.spjall.ui.Palette
import samtak.spjall.ui.Type
import samtak.spjall.ui.clockTime
import samtak.spjall.ui.shownName

/** What a bubble's one reaction pill shows (0045). */
internal data class Pill(
    /** Up to three, the most used first. */
    val emoji: List<String>,
    /** Every reaction on the item, shown when more than one. */
    val count: Int,
    /** One of them is the reader's: the pill takes the gold pair. */
    val own: Boolean,
)

internal fun Item.pill(): Pill? {
    if (reactions.isEmpty()) return null
    return Pill(
        emoji = reactions.sortedByDescending { it.people.size }.take(PILL_EMOJI).map { it.emoji },
        count = reactions.sumOf { it.people.size },
        own = reactions.any { it.own },
    )
}

/** One line of the reactions sheet: who put which emoji, and whether it is the reader. */
internal data class ReactionLine(
    val person: Person,
    val emoji: String,
    val mine: Boolean,
)

/** Everyone who reacted to the item, the reader first (0045). */
internal fun Item.reactionLines(me: String?): List<ReactionLine> =
    reactions
        .flatMap { reaction ->
            reaction.people.map { ReactionLine(it, reaction.emoji, reaction.own && it.account == me) }
        }.sortedByDescending { it.mine }

/**
 * The reader's account, from what the timeline already holds: the sender of
 * an own message, else whoever is on an own reaction but not among the
 * [members], who are everyone here but the reader.
 */
internal fun readerAccount(
    items: List<Item>,
    members: List<Person>,
): String? {
    items.firstOrNull { it.own }?.let { return it.sender.account }
    val others = members.map { it.account }.toSet()
    return items
        .asSequence()
        .flatMap { it.reactions }
        .filter { it.own }
        .flatMap { it.people }
        .map { it.account }
        .firstOrNull { it !in others }
}

/** The time is no longer drawn under the bubble, so TalkBack hears it with the reactions (0022, 0045). */
@Composable
internal fun spokenWith(
    item: Item,
    pill: Pill?,
): String =
    listOfNotNull(
        clockTime(item.at()),
        pill?.let { pluralStringResource(R.plurals.reaction_count, it.count, it.count) },
    ).joinToString(", ")

/** The pill on the bubble's bottom edge; the bubble's own element speaks for it. */
@Composable
internal fun ReactionPill(
    pill: Pill,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(PILL_HEIGHT.dp),
        color = if (pill.own) Palette.secondary else Palette.muted,
        contentColor = if (pill.own) Palette.secondaryFg else Palette.fg,
        border = BorderStroke(PILL_BORDER.dp, Palette.surface),
        modifier = modifier.heightIn(min = PILL_HEIGHT.dp).clearAndSetSemantics { },
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(text = pill.emoji.joinToString(""), style = MaterialTheme.typography.labelLarge)
            if (pill.count > 1) {
                Text(
                    text = "${pill.count}",
                    style = MaterialTheme.typography.labelLarge,
                    modifier = Modifier.padding(start = 3.dp),
                )
            }
        }
    }
}

/** "Viðbrögð": who reacted with what, the reader first; tapping the reader's line takes it away (0045). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ReactionsSheet(
    lines: List<ReactionLine>,
    onRemove: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Palette.surface) {
        Column(modifier = Modifier.verticalScroll(rememberScrollState()).padding(bottom = 16.dp)) {
            Text(
                text = stringResource(R.string.reactions_title),
                style = MaterialTheme.typography.titleMedium,
                color = Palette.fg,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp).semantics { heading() },
            )
            lines.forEach { line ->
                val tap =
                    if (line.mine) {
                        Modifier.clickable(role = Role.Button) {
                            onRemove(line.emoji)
                            onDismiss()
                        }
                    } else {
                        Modifier
                    }
                Row(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .heightIn(min = LINE.dp)
                            .then(tap)
                            .padding(horizontal = 16.dp, vertical = 6.dp)
                            .semantics(mergeDescendants = true) { },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Avatar(line.person, size = AVATAR.dp)
                    Column(modifier = Modifier.weight(1f).padding(start = 12.dp)) {
                        NameWithMark(
                            name = line.person.shownName(),
                            verified = line.person.verified,
                            style = MaterialTheme.typography.bodyLarge,
                            color = Palette.fg,
                            markSize = 14.dp,
                        )
                        if (line.mine) {
                            Text(
                                text = stringResource(R.string.reaction_remove_hint),
                                style = Type.meta,
                                color = Palette.mutedFg,
                            )
                        }
                    }
                    Text(text = line.emoji, style = MaterialTheme.typography.titleLarge)
                }
            }
        }
    }
}

internal const val PILL_HEIGHT = 24
private const val PILL_BORDER = 2
private const val PILL_EMOJI = 3
private const val LINE = 56
private const val AVATAR = 36
