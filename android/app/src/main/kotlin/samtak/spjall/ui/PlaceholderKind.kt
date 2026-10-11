package samtak.spjall.ui

import androidx.compose.animation.core.InfiniteRepeatableSpec
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R

/** The shape of the rows a list will have; the conversation list's is the only one left (decision 0044). */
enum class PlaceholderKind {
    Conversation,
}

/**
 * Grey rows where a list's rows will be, until its first read returns
 * (decision 0043): a blank screen reads as a broken one. The shapes say
 * nothing; the whole is read out once as "loading". They pulse, unless the
 * system removes animations (0022).
 */
@Composable
fun PlaceholderRows(
    kind: PlaceholderKind,
    modifier: Modifier = Modifier,
    count: Int = ROWS,
) {
    val loading = stringResource(R.string.loading)
    val alpha = if (LocalReduceMotion.current) 1f else pulse()
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .alpha(alpha)
                .clearAndSetSemantics {
                    contentDescription = loading
                    liveRegion = LiveRegionMode.Polite
                },
    ) {
        repeat(count) { index ->
            when (kind) {
                PlaceholderKind.Conversation -> ConversationShape(index)
            }
            HorizontalDivider(color = Palette.border)
        }
    }
}

@Composable
private fun pulse(): Float {
    val transition = rememberInfiniteTransition(label = "placeholder")
    val alpha by transition.animateFloat(
        initialValue = 1f,
        targetValue = DIM,
        animationSpec = InfiniteRepeatableSpec(tween(PULSE_MS), RepeatMode.Reverse),
        label = "placeholder alpha",
    )
    return alpha
}

/** An avatar, a name and a preview line, as a conversation row has. */
@Composable
private fun ConversationShape(index: Int) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(modifier = Modifier.size(AVATAR_SIZE.dp).background(Palette.muted, CircleShape))
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Bar(NAME_SHARES[index % NAME_SHARES.size])
            Bar(LINE_SHARES[index % LINE_SHARES.size])
        }
    }
}

@Composable
private fun Bar(share: Float) {
    Box(
        modifier =
            Modifier
                .fillMaxWidth(share)
                .height(BAR.dp)
                .background(Palette.muted, RoundedCornerShape(BAR.dp)),
    )
}

/** Enough to fill a phone's screen. */
private const val ROWS = 6
private const val BAR = 10
private const val DIM = 0.45f
private const val PULSE_MS = 900

/** Rows of different lengths, so the shapes read as rows and not as a pattern. */
private val NAME_SHARES = listOf(0.45f, 0.35f, 0.55f)
private val LINE_SHARES = listOf(0.8f, 0.65f, 0.72f, 0.58f)
