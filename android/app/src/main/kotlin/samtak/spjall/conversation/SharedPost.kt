package samtak.spjall.conversation

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.conversation.ConversationViewModel.Shared
import samtak.spjall.core.Content
import samtak.spjall.core.Item
import samtak.spjall.core.Quote
import samtak.spjall.ui.NameWithMark
import samtak.spjall.ui.Type
import samtak.spjall.ui.shownName

/** What a tap on the bubble does: a photo or file opens, and a shared post once there is one to open (0040). */
internal fun Item.tap(
    posts: Map<String, Shared>,
    actions: ConversationActions,
): (() -> Unit)? =
    when (val content = content) {
        is Content.Media -> ({ actions.open(this) })
        is Content.Post -> if (posts[content.postId] is Shared.Found) ({ actions.openPost(content.postId) }) else null
        else -> null
    }

/** A forward names no original sender, only that it is one (decision 0041). */
@Composable
internal fun ForwardedMark(foreground: Color) {
    Text(
        text = stringResource(R.string.forwarded_marker),
        style = Type.meta,
        fontStyle = FontStyle.Italic,
        color = foreground,
        modifier = Modifier.padding(bottom = 4.dp),
    )
}

/** The message a reply answers; a reply to a share quotes the post as its card, since the store holds no text of it. */
@Composable
internal fun Quoted(
    quote: Quote,
    posts: Map<String, Shared>,
    foreground: Color,
    actions: ConversationActions,
) {
    Column(modifier = Modifier.padding(bottom = 4.dp)) {
        Text(
            text = quote.sender?.shownName() ?: "",
            style = MaterialTheme.typography.labelMedium,
            color = foreground,
        )
        val post = quote.postId
        if (post != null) {
            SharedCard(post, posts[post], foreground, actions, QUOTE_LINES)
        } else {
            Text(
                text = quote.text ?: stringResource(R.string.message_deleted),
                style = MaterialTheme.typography.bodySmall,
                fontStyle = FontStyle.Italic,
                color = foreground,
                maxLines = QUOTE_LINES,
                overflow = TextOverflow.Ellipsis,
            )
        }
        HorizontalDivider(color = foreground, modifier = Modifier.padding(top = 4.dp))
    }
}

/**
 * A Fljótið post shared here (decision 0040): its author and text as the
 * server holds them now, fetched while the card is on screen and kept
 * nowhere. Until it comes, and when it cannot, only fixed words.
 */
@Composable
internal fun SharedCard(
    postId: String,
    shared: Shared?,
    foreground: Color,
    actions: ConversationActions,
    lines: Int = Int.MAX_VALUE,
) {
    LaunchedEffect(postId) { actions.showPost(postId) }
    Row(modifier = Modifier.height(IntrinsicSize.Min)) {
        Box(modifier = Modifier.width(3.dp).fillMaxHeight().background(foreground))
        Column(modifier = Modifier.padding(start = 10.dp)) {
            when (shared) {
                is Shared.Found -> {
                    NameWithMark(
                        name = shared.post.author.shownName(),
                        verified = shared.post.author.verified,
                        style = MaterialTheme.typography.labelLarge,
                        color = foreground,
                        markSize = 13.dp,
                    )
                    Text(
                        text = shared.post.body,
                        style = Type.bubble,
                        color = foreground,
                        maxLines = lines,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Shared.Gone -> Quiet(stringResource(R.string.post_gone), foreground)
                Shared.Failed -> {
                    Quiet(stringResource(R.string.post_load_failed), foreground)
                    TextButton(onClick = { actions.showPost(postId) }) {
                        Text(stringResource(R.string.try_again), color = foreground)
                    }
                }
                Shared.Loading, null -> Quiet(stringResource(R.string.post_shared), foreground)
            }
        }
    }
}

@Composable
private fun Quiet(
    text: String,
    foreground: Color,
) {
    Text(text = text, style = Type.bubble, fontStyle = FontStyle.Italic, color = foreground)
}

private const val QUOTE_LINES = 2
