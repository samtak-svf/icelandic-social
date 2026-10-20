package samtak.spjall.social

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.Author
import samtak.spjall.core.Community
import samtak.spjall.core.CommunityAudience
import samtak.spjall.core.ModerationState
import samtak.spjall.core.Post
import samtak.spjall.core.ReactionKind
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.Palette
import samtak.spjall.ui.VerifiedMark
import samtak.spjall.ui.listStamp

// What the community screens share. Their content is hosted, not end-to-end encrypted (decision 0060), so
// they never look like a conversation: no bubbles, each post and comment a bordered card on the cream ground.

/** The safe-drawing sides a non-tab social screen pads for; [SubHeader] pads for the top. */
val SUB_SCREEN_SIDES = WindowInsetsSides.Horizontal + WindowInsetsSides.Bottom

/** Who wrote something: a deleted account has no author, an account without a name is unnamed. */
@Composable
fun Author?.shownName(): String =
    when {
        this == null -> stringResource(R.string.person_deleted)
        else -> name ?: stringResource(R.string.person_unnamed)
    }

/** The header of a screen opened from a tab: back, then the title. */
@Composable
fun SubHeader(
    title: String,
    onBack: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .background(Palette.bg)
                .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top))
                .padding(start = 4.dp, end = 16.dp, top = 4.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onBack) {
            Icon(AppIcons.Back, contentDescription = stringResource(R.string.back))
        }
        Text(
            text = title,
            style = MaterialTheme.typography.headlineSmall,
            modifier = Modifier.weight(1f).semantics { heading() },
        )
    }
}

/** A bordered white card on the cream ground: a post, a comment, a report or a community. */
@Composable
fun SocialCard(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .background(Palette.surface, RoundedCornerShape(CARD_RADIUS.dp))
                .border(BorderStroke(1.dp, Palette.border), RoundedCornerShape(CARD_RADIUS.dp))
                .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        content = content,
    )
}

/** "Opið · 12 meðlimir": the audience, and how many are in it when this account may know. */
@Composable
fun CommunityLine(community: Community) {
    val audience =
        stringResource(
            if (community.audience == CommunityAudience.OPEN) R.string.community_open else R.string.community_private,
        )
    val members =
        community.memberCount?.let { pluralStringResource(R.plurals.community_members, it.toInt(), it.toLong()) }
    Text(
        text = listOfNotNull(audience, members).joinToString(" · "),
        style = MaterialTheme.typography.bodySmall,
        color = Palette.mutedFg,
    )
}

/** A community in a list: its name and its line; a tap opens it. */
@Composable
fun CommunityRow(
    community: Community,
    onOpen: () -> Unit,
) {
    SocialCard(modifier = Modifier.clickable(role = Role.Button, onClick = onOpen)) {
        Text(text = community.name, style = MaterialTheme.typography.titleMedium)
        CommunityLine(community)
    }
}

/** The mark on content only a moderator still sees, or nothing. */
@Composable
fun StateMark(state: ModerationState) {
    val text =
        when (state) {
            ModerationState.VISIBLE -> return
            ModerationState.HIDDEN -> R.string.content_hidden
            ModerationState.REMOVED -> R.string.content_removed
        }
    Text(
        text = stringResource(text),
        style = MaterialTheme.typography.labelLarge,
        color = Palette.danger,
    )
}

/** Who wrote it, verified or not, and when. */
@Composable
fun Byline(
    author: Author,
    createdAt: ULong,
) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(
            text = author.shownName(),
            style = MaterialTheme.typography.titleSmall,
            modifier = Modifier.weight(1f, fill = false),
        )
        if (author.verified) VerifiedMark()
        Text(
            text = listStamp(createdAt),
            style = MaterialTheme.typography.bodySmall,
            color = Palette.mutedFg,
        )
    }
}

/**
 * A post as a community's feed and its own screen show it: the byline, its text and images, the five reactions
 * and its comment count, which opens it when [onOpen] is given. This account's own post offers [onDelete] in place
 * of a report.
 */
@Composable
fun PostCard(
    post: Post,
    reacting: Boolean,
    reported: Boolean,
    onReact: (ReactionKind) -> Unit,
    onReport: () -> Unit,
    onOpen: (() -> Unit)?,
    onDelete: (() -> Unit)? = null,
) {
    SocialCard {
        StateMark(post.state)
        Byline(post.author, post.createdAt)
        if (post.body.isNotBlank()) Text(text = post.body, style = MaterialTheme.typography.bodyLarge)
        PostImageGrid(post)
        Reactions(post, reacting, onReact)
        // Side by side while both fit; at a large text size the second goes under the first instead of cutting it.
        FlowRow(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            itemVerticalAlignment = Alignment.CenterVertically,
        ) {
            val comments =
                pluralStringResource(R.plurals.post_comments, post.commentCount.toInt(), post.commentCount.toLong())
            if (onOpen != null) {
                TextButton(onClick = onOpen) { Text(comments) }
            } else {
                Text(text = comments, style = MaterialTheme.typography.bodyMedium, color = Palette.mutedFg)
            }
            if (onDelete != null) DeleteControl(onDelete) else ReportControl(reported, onReport)
        }
    }
}

/** "Tilkynna", or, once sent, that it was. */
@Composable
fun ReportControl(
    reported: Boolean,
    onReport: () -> Unit,
) {
    if (reported) {
        Text(
            text = stringResource(R.string.report_sent),
            style = MaterialTheme.typography.bodySmall,
            color = Palette.mutedFg,
        )
    } else {
        TextButton(onClick = onReport) { Text(stringResource(R.string.report)) }
    }
}

/** The five reactions; this account's is pressed, and pressing it again takes it back. */
@Composable
private fun Reactions(
    post: Post,
    busy: Boolean,
    onReact: (ReactionKind) -> Unit,
) {
    val counts = post.reactions.associate { it.kind to it.count }
    val title = stringResource(R.string.reactions_title)
    FlowRow(
        modifier = Modifier.semantics { contentDescription = title }.selectableGroup(),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        REACTIONS.forEach { (kind, emoji, label) ->
            val mine = post.myReaction == kind
            val count = counts[kind] ?: 0uL
            val name = stringResource(label)
            Row(
                modifier =
                    Modifier
                        .heightIn(min = TOUCH.dp)
                        .widthIn(min = TOUCH.dp)
                        .background(if (mine) Palette.primarySubtle else Palette.surface, RoundedCornerShape(PILL.dp))
                        .border(
                            BorderStroke(1.dp, if (mine) Palette.primary else Palette.border),
                            RoundedCornerShape(PILL.dp),
                        ).toggleable(value = mine, enabled = !busy, role = Role.Checkbox) { onReact(kind) }
                        .clearAndSetSemantics { contentDescription = if (count > 0uL) "$name, $count" else name }
                        .padding(horizontal = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp, Alignment.CenterHorizontally),
            ) {
                Text(text = emoji, style = MaterialTheme.typography.titleMedium)
                if (count > 0uL) Text(text = "$count", style = MaterialTheme.typography.labelLarge)
            }
        }
    }
}

/**
 * The box a post and a comment are both written in, with its button under it; [extra] goes between them (a
 * post's images), and [ready] says whether there is something to send.
 */
@Composable
fun Composer(
    label: String,
    action: String,
    text: String,
    sending: Boolean,
    onText: (String) -> Unit,
    onSend: () -> Unit,
    ready: Boolean = text.isNotBlank(),
    extra: @Composable ColumnScope.() -> Unit = {},
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(
            value = text,
            onValueChange = onText,
            label = { Text(label) },
            minLines = 2,
            modifier = Modifier.fillMaxWidth(),
        )
        extra()
        Button(
            onClick = onSend,
            enabled = !sending && ready,
            modifier = Modifier.align(Alignment.End).heightIn(min = TOUCH.dp),
        ) { Text(action) }
    }
}

private data class Reaction(
    val kind: ReactionKind,
    val emoji: String,
    val label: Int,
)

private val REACTIONS =
    listOf(
        Reaction(ReactionKind.LIKE, "👍", R.string.reaction_like),
        Reaction(ReactionKind.LOVE, "❤️", R.string.reaction_love),
        Reaction(ReactionKind.LAUGH, "😂", R.string.reaction_laugh),
        Reaction(ReactionKind.WOW, "😮", R.string.reaction_wow),
        Reaction(ReactionKind.SAD, "😢", R.string.reaction_sad),
    )

private const val CARD_RADIUS = 14
private const val PILL = 20
private const val TOUCH = 44
