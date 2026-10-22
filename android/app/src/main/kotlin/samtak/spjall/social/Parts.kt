package samtak.spjall.social

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
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
import samtak.spjall.ui.Avatar
import samtak.spjall.ui.AvatarKind
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
    trailing: @Composable () -> Unit = {},
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
        trailing()
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
fun CommunityLine(
    community: Community,
    onClick: (() -> Unit)? = null,
) {
    val audience =
        stringResource(
            if (community.audience == CommunityAudience.OPEN) R.string.community_open else R.string.community_private,
        )
    val members =
        community.memberCount?.let { pluralStringResource(R.plurals.community_members, it.toInt(), it.toLong()) }
    val line = Modifier.run { if (onClick == null) this else clickable(role = Role.Button, onClick = onClick) }
    Text(
        text = listOfNotNull(audience, members).joinToString(" · "),
        style = MaterialTheme.typography.bodySmall,
        color = Palette.mutedFg,
        modifier = line,
    )
}

/** A community in a list: its name and its line; a tap opens it. */
@Composable
fun CommunityRow(
    community: Community,
    onOpen: () -> Unit,
) {
    SocialCard(modifier = Modifier.clickable(role = Role.Button, onClick = onOpen)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Avatar(name = community.name, kind = AvatarKind.Group, size = 40.dp)
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(text = community.name, style = MaterialTheme.typography.titleMedium)
                CommunityLine(community)
            }
        }
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

/** Who wrote it: their initials in a circle, verified or not, and when; [trailing] sits on the right. */
@Composable
fun Byline(
    author: Author,
    createdAt: ULong,
    trailing: @Composable () -> Unit = {},
) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Avatar(
            name = author.name,
            kind = if (author.verified) AvatarKind.Verified else AvatarKind.Unverified,
            size = 34.dp,
        )
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(text = author.shownName(), style = MaterialTheme.typography.titleSmall)
                if (author.verified) VerifiedMark()
            }
            Text(
                text = listStamp(createdAt),
                style = MaterialTheme.typography.bodySmall,
                color = Palette.mutedFg,
            )
        }
        Spacer(Modifier.weight(1f))
        trailing()
    }
}

/**
 * A post as a community's feed and its own screen show it: the byline, its text and images, the five reactions
 * and its comment count, which opens it when [onOpen] is given; a tap anywhere on the card opens it too. This
 * account's own post offers a delete in place of a report, both behind the byline's more menu.
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
    SocialCard(
        modifier =
            if (onOpen != null) {
                Modifier.clickable(role = Role.Button, onClick = onOpen)
            } else {
                Modifier
            },
    ) {
        StateMark(post.state)
        Byline(post.author, post.createdAt) {
            CardActions(reported = reported, onReport = onReport, onDelete = onDelete)
        }
        if (post.body.isNotBlank()) Text(text = post.body, style = MaterialTheme.typography.bodyLarge)
        PostImageGrid(post)
        Reactions(post, reacting, onReact)
        val comments =
            pluralStringResource(R.plurals.post_comments, post.commentCount.toInt(), post.commentCount.toLong())
        if (onOpen != null) {
            TextButton(onClick = onOpen) { Text(comments) }
        } else {
            Text(text = comments, style = MaterialTheme.typography.bodyMedium, color = Palette.mutedFg)
        }
    }
}

/**
 * The more menu on a post or a comment: delete this account's own, or report it; once the report was sent it
 * says so instead of offering another.
 */
@Composable
fun CardActions(
    reported: Boolean,
    onReport: () -> Unit,
    onDelete: (() -> Unit)?,
) {
    var open by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { open = true }) {
            Icon(AppIcons.More, contentDescription = stringResource(R.string.more_options))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            when {
                onDelete != null ->
                    DropdownMenuItem(
                        text = { Text(stringResource(R.string.delete), color = Palette.danger) },
                        onClick = {
                            open = false
                            onDelete()
                        },
                    )
                reported ->
                    DropdownMenuItem(
                        text = { Text(stringResource(R.string.report_sent)) },
                        onClick = { open = false },
                        enabled = false,
                    )
                else ->
                    DropdownMenuItem(
                        text = { Text(stringResource(R.string.report)) },
                        onClick = {
                            open = false
                            onReport()
                        },
                    )
            }
        }
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
