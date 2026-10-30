package samtak.spjall.social

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.Author
import samtak.spjall.core.Card
import samtak.spjall.core.Community
import samtak.spjall.core.CommunityAudience
import samtak.spjall.core.ModerationState
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.Avatar
import samtak.spjall.ui.AvatarKind
import samtak.spjall.ui.NameWithMark
import samtak.spjall.ui.Palette
import samtak.spjall.ui.TrailingBell
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

/** Who a shared or reported post's card names: its author, or the anonymous byline when it has none (0091). */
@Composable
fun Card.Post.bylineName(): String = anonymousBylineRes()?.let { stringResource(it) } ?: author.shownName()

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
        TrailingBell()
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

/** `community_open` or `community_private`, and how many are in it when this account may know. */
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

/** The mark on content only a moderator still sees, or nothing. */
@Composable
fun StateMark(state: ModerationState) {
    val text =
        when (state) {
            ModerationState.VISIBLE -> return
            ModerationState.HIDDEN -> R.string.content_hidden
            ModerationState.REMOVED -> R.string.content_removed
            ModerationState.PENDING -> R.string.post_pending
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
            NameWithMark(
                name = author.shownName(),
                verified = author.verified,
                style = MaterialTheme.typography.titleSmall,
                color = Palette.fg,
            )
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
 * The box a post is written in, with its button under it; [extra] goes between them (the post's images), and
 * [ready] says whether there is something to send.
 */
@Composable
fun Composer(
    label: String,
    action: String,
    text: String,
    sending: Boolean,
    onText: (String) -> Unit,
    onSend: () -> Unit,
    modifier: Modifier = Modifier,
    ready: Boolean = text.isNotBlank(),
    extra: @Composable ColumnScope.() -> Unit = {},
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(
            value = text,
            onValueChange = onText,
            label = { Text(label) },
            minLines = 2,
            enabled = !suspended(),
            modifier = modifier.fillMaxWidth(),
        )
        extra()
        Button(
            onClick = onSend,
            enabled = !sending && ready && !suspended(),
            modifier = Modifier.align(Alignment.End).heightIn(min = TOUCH.dp),
        ) { Text(action) }
    }
}

private const val CARD_RADIUS = 14
internal const val PILL = 20
internal const val TOUCH = 44
