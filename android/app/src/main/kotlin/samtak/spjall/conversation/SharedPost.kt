package samtak.spjall.conversation

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.layout
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.Content
import samtak.spjall.core.Item
import samtak.spjall.core.Quote
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.Palette
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

/**
 * The message a reply answers, as a quiet bubble of its own above the reply,
 * which overlaps its foot; over it, the arrow and who wrote it. A reply to a
 * shared post quotes it as its card, since the store holds no text of it.
 */
@Composable
internal fun QuoteAbove(
    quote: Quote,
    own: Boolean,
) {
    val foreground = Palette.mutedFg
    Row(
        modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(AppIcons.Reply, contentDescription = null, tint = foreground, modifier = Modifier.size(ARROW.dp))
        Text(
            text = quote.sender?.shownName() ?: "",
            style = Type.meta,
            color = foreground,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(start = 4.dp),
        )
    }
    Surface(
        // The other party's bubble is muted already, so the quote over it takes the paler cream.
        color = if (own) Palette.muted else Palette.bg,
        contentColor = foreground,
        shape = RoundedCornerShape(QUOTE_RADIUS.dp),
        modifier = Modifier.overlappedBy(OVERLAP.dp).semantics(mergeDescendants = true) { },
    ) {
        Box(
            modifier =
                Modifier.padding(
                    start = PAD_X.dp,
                    end = PAD_X.dp,
                    top = PAD_Y.dp,
                    bottom = (PAD_Y + OVERLAP).dp,
                ),
        ) {
            when {
                quote.postId != null -> SharedCard(foreground)
                // Never the place in a quote, as in the list (decision 0059).
                quote.location ->
                    Text(
                        text = stringResource(R.string.location),
                        style = MaterialTheme.typography.bodyMedium,
                        fontStyle = FontStyle.Italic,
                        color = foreground,
                    )
                else ->
                    Text(
                        text = quote.text ?: stringResource(R.string.message_deleted),
                        style = MaterialTheme.typography.bodyMedium,
                        fontStyle = if (quote.text == null) FontStyle.Italic else FontStyle.Normal,
                        color = foreground,
                        maxLines = QUOTE_LINES,
                        overflow = TextOverflow.Ellipsis,
                    )
            }
        }
    }
}

/** Reports [by] less height than it draws, so whatever comes next is laid over its foot. */
private fun Modifier.overlappedBy(by: Dp) =
    layout { measurable, constraints ->
        val placeable = measurable.measure(constraints)
        val height = (placeable.height - by.roundToPx()).coerceAtLeast(0)
        layout(placeable.width, height) { placeable.place(0, 0) }
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
private const val QUOTE_RADIUS = 18
private const val OVERLAP = 8
private const val ARROW = 12
