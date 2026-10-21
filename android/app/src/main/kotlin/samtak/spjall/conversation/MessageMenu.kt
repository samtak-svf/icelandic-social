package samtak.spjall.conversation

import androidx.activity.compose.BackHandler
import androidx.annotation.StringRes
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredHeight
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
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
import androidx.compose.ui.graphics.Color
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
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.traversalIndex
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.Content
import samtak.spjall.core.Item
import samtak.spjall.core.placeLinks
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

/** Which action a [MenuAction] is, so the bar can order them (0072). */
internal enum class MenuKind { Reply, Copy, Forward, Edit, Delete }

/** One action on the lifted message: its icon, its words, and whether it destroys something. */
internal class MenuAction(
    val kind: MenuKind,
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

    /**
     * What copy puts on the clipboard: the whole text, also under a timer, since the reader can already
     * read it (0046), or a location's point (0059). Asked for only on a copy, so building the menu never
     * calls the core.
     */
    val copy: (() -> String)? =
        when (val content = item.content) {
            is Content.Text -> ({ content.text })
            is Content.Location -> ({ placeLinks(content.latE6, content.lonE6).copy })
            else -> null
        }?.takeIf { live }

    /**
     * Text, a file or a location (0059), not under a timer, where a copy would outlive the original
     * (0041); never a shared post (0044).
     */
    val forward =
        live &&
            item.expiresAt == null &&
            (item.content is Content.Text || item.content is Content.Media || item.content is Content.Location)
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
        if (offer.reply) {
            MenuAction(
                MenuKind.Reply,
                R.string.reply,
                AppIcons.Reply,
            ) { actions.reply(offer.item) }
        } else {
            null
        },
        offer.copy?.let { text -> MenuAction(MenuKind.Copy, R.string.copy, AppIcons.Copy) { onCopy(text()) } },
        if (offer.forward) {
            MenuAction(MenuKind.Forward, R.string.forward, AppIcons.Forward) { actions.forward(offer.item) }
        } else {
            null
        },
        if (offer.edit) MenuAction(MenuKind.Edit, R.string.edit, AppIcons.Edit) { actions.edit(offer.item) } else null,
        if (offer.delete) {
            MenuAction(MenuKind.Delete, R.string.delete_for_everyone, AppIcons.Trash, danger = true) {
                onDelete(offer.item)
            }
        } else {
            null
        },
    )

/** What a long press lifts: the bubble where it is on screen, drawn again by [bubble]. */
internal class MenuRequest(
    val at: LayoutCoordinates,
    val own: Boolean,
    val reactions: List<String>,
    /** The emoji the reader already gave this message, marked in the row (0072). */
    val chosen: Set<String>,
    val onReact: (String) -> Unit,
    val actions: List<MenuAction>,
    val bubble: @Composable () -> Unit,
)

/** The conversation's one open message menu, if any, and the sheet it handed on to. */
internal class MessageMenuState {
    var open by mutableStateOf<MenuRequest?>(null)

    /** What did not fit in the bar, once "more" is tapped. */
    var more by mutableStateOf<List<MenuAction>?>(null)

    /** Where an emoji from the full picker goes, once "+" is tapped. */
    var picker by mutableStateOf<((String) -> Unit)?>(null)
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
            MessageMenu(request, origin, state) { state.open = null }
        }
        state.more?.let { MoreSheet(it) { state.more = null } }
        state.picker?.let { onReact -> EmojiPickerSheet(onReact) { state.picker = null } }
    }
}

@Composable
private fun MessageMenu(
    request: MenuRequest,
    host: LayoutCoordinates,
    state: MessageMenuState,
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
    val close = stringResource(R.string.cancel)
    Layout(
        modifier = Modifier.fillMaxSize().graphicsLayer { alpha = lift.value }.scrim(close, onDismiss),
        content = {
            Box(Modifier.semantics { traversalIndex = 0f }) {
                if (request.reactions.isNotEmpty()) {
                    ReactionsCard(
                        request.reactions,
                        request.chosen,
                        onPick = {
                            onDismiss()
                            request.onReact(it)
                        },
                        onMore = {
                            onDismiss()
                            state.picker = request.onReact
                        },
                    )
                }
            }
            Lifted(request.bubble, bounds.height.toInt(), lift.value)
            Box(Modifier.semantics { traversalIndex = 1f }) {
                if (request.actions.isNotEmpty()) {
                    val bar = barActions(request.actions)
                    ActionBar(
                        bar,
                        onPick = {
                            onDismiss()
                            it.act()
                        },
                        onMore = {
                            onDismiss()
                            state.more = bar.more
                        },
                    )
                }
            }
        },
        measurePolicy = menuPolicy(bounds, request.own, windowTop),
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

/**
 * Measures the bar at the foot first, then puts the reactions and the lifted bubble where
 * [placeMenu] says in the room above it (0072).
 */
private fun menuPolicy(
    bounds: Rect,
    own: Boolean,
    windowTop: Int,
) = MeasurePolicy { measurables, constraints ->
    val (reactionsM, bubbleM, barM) = measurables
    val width = constraints.maxWidth
    val height = constraints.maxHeight
    val loose = constraints.copy(minWidth = 0, minHeight = 0)
    val reactions = reactionsM.measure(loose)
    val bar = barM.measure(loose.copy(minWidth = width))
    val place =
        placeMenu(
            bubbleTop = bounds.top.toInt(),
            bubbleHeight = bounds.height.toInt(),
            reactions = reactions.height,
            actions = 0,
            gap = GAP.dp.roundToPx(),
            windowTop = windowTop,
            windowBottom = height - bar.height,
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
        bar.place(0, height - bar.height)
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

/** The emoji row, ending in "+" for every other emoji; one the reader already gave is marked (0072). */
@Composable
private fun ReactionsCard(
    emoji: List<String>,
    chosen: Set<String>,
    onPick: (String) -> Unit,
    onMore: () -> Unit,
) {
    Surface(shape = CircleShape, color = Palette.surface, border = edge(), shadowElevation = 6.dp) {
        Row(modifier = Modifier.padding(horizontal = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            emoji.forEach { e ->
                Surface(
                    onClick = { onPick(e) },
                    shape = CircleShape,
                    color = if (e in chosen) ownWash() else Color.Transparent,
                    border = if (e in chosen) BorderStroke(RING.dp, Palette.verifiedMark) else null,
                    modifier = Modifier.size(EMOJI.dp).semantics { selected = e in chosen },
                ) {
                    Box(contentAlignment = Alignment.Center) { Text(e, style = MaterialTheme.typography.titleLarge) }
                }
            }
            Surface(
                onClick = onMore,
                shape = CircleShape,
                color = Palette.muted,
                contentColor = Palette.fg,
                modifier = Modifier.padding(start = 4.dp, end = 2.dp).size(PLUS.dp),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(AppIcons.Plus, contentDescription = stringResource(R.string.react_any))
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
private const val EMOJI = 44
private const val RING = 1.5f
private const val PLUS = 40
private const val SCRIM = 0.45f
private const val LIFT_MS = 160
private const val LIFT_SCALE = 0.03f
