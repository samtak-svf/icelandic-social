package samtak.spjall.conversation

import androidx.activity.compose.BackHandler
import androidx.annotation.StringRes
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredHeight
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.MeasurePolicy
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.traversalIndex
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.Content
import samtak.spjall.core.Item
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.LocalReduceMotion
import samtak.spjall.ui.Palette
import kotlin.math.max
import kotlin.math.min

/** Where the menu's three parts go, top to bottom, in the host's pixels (0054). */
internal data class MenuPlace(
    val reactionsTop: Int,
    val bubbleTop: Int,
    val bubbleHeight: Int,
    val actionsTop: Int,
)

/**
 * Places the reactions above the pressed message and the actions below it, between [windowTop]
 * and [windowBottom]. The message stays where it was when the group fits there; otherwise the
 * group moves the least distance that fits it, and a message taller than the room is cut at its
 * foot so both cards still show. A part of height 0 keeps no [gap].
 */
internal fun placeMenu(
    bubbleTop: Int,
    bubbleHeight: Int,
    reactions: Int,
    actions: Int,
    gap: Int,
    windowTop: Int,
    windowBottom: Int,
): MenuPlace {
    val above = if (reactions > 0) reactions + gap else 0
    val below = if (actions > 0) actions + gap else 0
    val shown = min(bubbleHeight, windowBottom - windowTop - above - below).coerceAtLeast(0)
    val group = above + shown + below
    val top = (bubbleTop - above).coerceIn(windowTop, max(windowTop, windowBottom - group))
    return MenuPlace(
        reactionsTop = top,
        bubbleTop = top + above,
        bubbleHeight = shown,
        actionsTop = top + above + shown + (if (actions > 0) gap else 0),
    )
}

/** One action under the lifted message: its icon, its words, and whether it destroys something. */
internal class MenuAction(
    @StringRes val label: Int,
    val icon: ImageVector,
    val danger: Boolean = false,
    val act: () -> Unit,
)

/** What a long press offers on this item. */
internal class Offer(
    val item: Item,
) {
    private val sent = item.seq != null && item.envelopeId != null

    // An unreadable row offers nothing: there is nothing in it to act on (0051).
    private val live = sent && item.content != Content.Deleted && item.content !is Content.Unreadable
    val reply = live

    /** The whole text, also under a timer: the reader can already read it (0046). */
    val copy = (item.content as? Content.Text)?.text?.takeIf { live }

    /**
     * Text or a file, not under a timer, where a copy would outlive the original (0041); never a
     * shared post (0044).
     */
    val forward =
        live &&
            item.expiresAt == null &&
            (item.content is Content.Text || item.content is Content.Media)
    val react = live
    val edit = live && item.own && item.content is Content.Text
    val delete = live && item.own
    val any = reply || react || edit || delete
}

/** The long-press menu's actions, in their order (0022), each with its icon; deleting for everyone is last. */
internal fun menuActions(
    offer: Offer,
    actions: ConversationActions,
    onDelete: (Item) -> Unit,
    onCopy: (String) -> Unit,
): List<MenuAction> =
    listOfNotNull(
        if (offer.reply) MenuAction(R.string.reply, AppIcons.Reply) { actions.reply(offer.item) } else null,
        offer.copy?.let { text -> MenuAction(R.string.copy, AppIcons.Copy) { onCopy(text) } },
        if (offer.forward) MenuAction(R.string.forward, AppIcons.Forward) { actions.forward(offer.item) } else null,
        if (offer.edit) MenuAction(R.string.edit, AppIcons.Edit) { actions.edit(offer.item) } else null,
        if (offer.delete) {
            MenuAction(R.string.delete_for_everyone, AppIcons.Trash, danger = true) { onDelete(offer.item) }
        } else {
            null
        },
    )

/** What a long press lifts: the bubble where it is on screen, drawn again by [bubble]. */
internal class MenuRequest(
    val at: LayoutCoordinates,
    val own: Boolean,
    val reactions: List<String>,
    val onReact: (String) -> Unit,
    val actions: List<MenuAction>,
    val bubble: @Composable () -> Unit,
)

/** The conversation's one open message menu, if any. */
internal class MessageMenuState {
    var open by mutableStateOf<MenuRequest?>(null)
}

/** The menu a bubble opens; null outside [MessageMenuHost], where a long press offers nothing. */
internal val LocalMessageMenu = staticCompositionLocalOf<MessageMenuState?> { null }

/** Lays [content] out and, over it, the open message menu, which takes every touch while it shows. */
@Composable
internal fun MessageMenuHost(
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val state = remember { MessageMenuState() }
    var host by remember { mutableStateOf<LayoutCoordinates?>(null) }
    Box(modifier = modifier.onGloballyPositioned { host = it }) {
        CompositionLocalProvider(LocalMessageMenu provides state) { content() }
        val request = state.open
        val origin = host
        if (request != null && origin != null && request.at.isAttached) {
            MessageMenu(request, origin) { state.open = null }
        }
    }
}

@Composable
private fun MessageMenu(
    request: MenuRequest,
    host: LayoutCoordinates,
    onDismiss: () -> Unit,
) {
    BackHandler(onBack = onDismiss)
    val reduce = LocalReduceMotion.current
    val lift = remember { Animatable(if (reduce) 1f else 0f) }
    LaunchedEffect(Unit) { if (!reduce) lift.animateTo(1f, tween(LIFT_MS)) }
    val bounds = host.localBoundingBoxOf(request.at, clipBounds = false)
    val density = LocalDensity.current
    val insets = WindowInsets.safeDrawing
    val windowTop = insets.getTop(density)
    val windowBottomInset = insets.getBottom(density)
    val close = stringResource(R.string.cancel)
    Layout(
        modifier = Modifier.fillMaxSize().graphicsLayer { alpha = lift.value }.scrim(close, onDismiss),
        content = {
            Box(Modifier.semantics { traversalIndex = 0f }) {
                if (request.reactions.isNotEmpty()) {
                    ReactionsCard(request.reactions) {
                        onDismiss()
                        request.onReact(it)
                    }
                }
            }
            Lifted(request.bubble, bounds.height.toInt(), lift.value)
            Box(Modifier.semantics { traversalIndex = 1f }) {
                if (request.actions.isNotEmpty()) {
                    ActionsCard(request.actions) {
                        onDismiss()
                        it.act()
                    }
                }
            }
        },
        measurePolicy = menuPolicy(bounds, request.own, windowTop, windowBottomInset),
    )
}

/** Dims what is behind and takes every touch: a tap closes the menu, and nothing behind it moves. */
@Composable
private fun Modifier.scrim(
    close: String,
    onDismiss: () -> Unit,
) = background(MaterialTheme.colorScheme.scrim.copy(alpha = SCRIM))
    .pointerInput(onDismiss) {
        awaitEachGesture {
            awaitFirstDown().consume()
            waitForUpOrCancellation()?.let {
                it.consume()
                onDismiss()
            }
        }
    }.semantics {
        onClick(label = close) {
            onDismiss()
            true
        }
    }

/** Measures the reactions, the lifted bubble and the actions, and puts them where [placeMenu] says. */
private fun menuPolicy(
    bounds: Rect,
    own: Boolean,
    windowTop: Int,
    windowBottomInset: Int,
) = MeasurePolicy { measurables, constraints ->
    val (reactionsM, bubbleM, actionsM) = measurables
    val width = constraints.maxWidth
    val height = constraints.maxHeight
    val loose = constraints.copy(minWidth = 0, minHeight = 0)
    val reactions = reactionsM.measure(loose)
    val actions = actionsM.measure(loose)
    val place =
        placeMenu(
            bubbleTop = bounds.top.toInt(),
            bubbleHeight = bounds.height.toInt(),
            reactions = reactions.height,
            actions = actions.height,
            gap = GAP.dp.roundToPx(),
            windowTop = windowTop,
            windowBottom = height - windowBottomInset,
        )
    val bubble = bubbleM.measure(Constraints.fixed(bounds.width.toInt(), place.bubbleHeight))
    val margin = MARGIN.dp.roundToPx()

    fun x(cardWidth: Int): Int {
        val start = if (own) bounds.right.toInt() - cardWidth else bounds.left.toInt()
        return start.coerceIn(margin, max(margin, width - cardWidth - margin))
    }
    layout(width, height) {
        reactions.place(x(reactions.width), place.reactionsTop)
        bubble.place(bounds.left.toInt(), place.bubbleTop)
        actions.place(x(actions.width), place.actionsTop)
    }
}

/** The bubble again, its top kept, cut to the height it is given; it takes no touch of its own. */
@Composable
private fun Lifted(
    bubble: @Composable () -> Unit,
    natural: Int,
    lift: Float,
) {
    val height = with(LocalDensity.current) { natural.toDp() }
    Box(
        modifier =
            Modifier
                .graphicsLayer {
                    val scale = 1f + LIFT_SCALE * lift
                    scaleX = scale
                    scaleY = scale
                }.clipToBounds()
                // Read already where it stands: TalkBack hears it once.
                .clearAndSetSemantics {},
    ) {
        Box(Modifier.wrapContentHeight(Alignment.Top, unbounded = true).requiredHeight(height)) { bubble() }
        Box(Modifier.matchParentSize().pointerInput(Unit) { awaitEachGesture { awaitFirstDown().consume() } })
    }
}

@Composable
private fun ReactionsCard(
    emoji: List<String>,
    onPick: (String) -> Unit,
) {
    Surface(shape = CircleShape, color = Palette.surface, border = edge(), shadowElevation = 6.dp) {
        Row(modifier = Modifier.padding(horizontal = 6.dp)) {
            emoji.forEach { e ->
                TextButton(onClick = { onPick(e) }) { Text(e, style = MaterialTheme.typography.titleLarge) }
            }
        }
    }
}

@Composable
private fun ActionsCard(
    actions: List<MenuAction>,
    onPick: (MenuAction) -> Unit,
) {
    Surface(
        shape = RoundedCornerShape(CARD_RADIUS.dp),
        color = Palette.surface,
        border = edge(),
        shadowElevation = 6.dp,
    ) {
        Column(modifier = Modifier.widthIn(min = CARD_WIDTH.dp).width(IntrinsicSize.Max)) {
            actions.forEachIndexed { index, action ->
                if (index > 0) HorizontalDivider(color = Palette.border)
                val tint = if (action.danger) Palette.danger else Palette.fg
                Row(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .clickable { onPick(action) }
                            .heightIn(min = 48.dp)
                            .padding(horizontal = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Icon(action.icon, contentDescription = null, tint = tint, modifier = Modifier.size(20.dp))
                    Text(stringResource(action.label), style = MaterialTheme.typography.bodyLarge, color = tint)
                }
            }
        }
    }
}

/** A card's rim: at night a shadow does not show on the dimmed screen, so the edge is drawn. */
@Composable
private fun edge() = BorderStroke(1.dp, Palette.border)

private const val GAP = 8
private const val MARGIN = 12
private const val CARD_RADIUS = 14
private const val CARD_WIDTH = 220
private const val SCRIM = 0.45f
private const val LIFT_MS = 160
private const val LIFT_SCALE = 0.03f
