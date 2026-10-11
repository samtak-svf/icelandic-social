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
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.Content
import samtak.spjall.core.Item
import samtak.spjall.core.Quote
import samtak.spjall.ui.Type
import samtak.spjall.ui.shownName

/** What a tap on the bubble does: a photo or file opens. */
internal fun Item.tap(actions: ConversationActions): (() -> Unit)? =
    when (content) {
        is Content.Media -> ({ actions.open(this) })
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

/** The message a reply answers; a reply to a shared post quotes it as its card, since the store holds no text of it. */
@Composable
internal fun Quoted(
    quote: Quote,
    foreground: Color,
) {
    Column(modifier = Modifier.padding(bottom = 4.dp)) {
        Text(
            text = quote.sender?.shownName() ?: "",
            style = MaterialTheme.typography.labelMedium,
            color = foreground,
        )
        if (quote.postId != null) {
            SharedCard(foreground)
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
 * A post shared here under decision 0040. Since 0044 there are no posts: the
 * card shows one fixed line and never asks the server for anything.
 */
@Composable
internal fun SharedCard(foreground: Color) {
    Row(modifier = Modifier.height(IntrinsicSize.Min)) {
        Box(modifier = Modifier.width(3.dp).fillMaxHeight().background(foreground))
        Text(
            text = stringResource(R.string.post_gone),
            style = Type.bubble,
            fontStyle = FontStyle.Italic,
            color = foreground,
            modifier = Modifier.padding(start = 10.dp),
        )
    }
}

private const val QUOTE_LINES = 2
