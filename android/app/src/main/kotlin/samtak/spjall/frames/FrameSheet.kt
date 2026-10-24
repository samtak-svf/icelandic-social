package samtak.spjall.frames

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateMap
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.collapse
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.expand
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import samtak.spjall.account.Problem
import samtak.spjall.brand.R
import samtak.spjall.core.Focus
import samtak.spjall.core.Frame
import samtak.spjall.core.FrameKind
import samtak.spjall.core.FrameRect
import samtak.spjall.core.Framing
import samtak.spjall.me.HINT
import samtak.spjall.me.Pill
import samtak.spjall.ui.Palette
import samtak.spjall.ui.ProblemCard

/** The session the app's one crop sheet runs on; provided once, around the whole app. */
val LocalFrameSession =
    compositionLocalOf<FrameSession> { error("no FrameSession provided") }

private const val SQUARE_MAX_DP = 280
private const val PANE_RADIUS = 12
private const val GAP = 12

/** The crop sheet as a full-screen dialog, shown while the [LocalFrameSession] has something to show. */
@Composable
fun FrameSheet(session: FrameSession = LocalFrameSession.current) {
    val state by session.state.collectAsState()
    if (state is FrameState.Closed) return
    Dialog(
        onDismissRequest = session::close,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        FrameSheetRoot(state, session::save, session::close)
    }
}

/**
 * What the dialog shows for [state]. The background draws edge to edge, the content stays inside [insets]: the
 * status and navigation bars, and a cutout, would otherwise cover the title and the Save row.
 */
@Composable
internal fun FrameSheetRoot(
    state: FrameState,
    onSave: (Framing) -> Unit,
    onClose: () -> Unit,
    insets: WindowInsets = WindowInsets.safeDrawing,
    rules: FrameRules = CoreFrameRules,
) {
    Box(Modifier.fillMaxSize().background(Palette.bg)) {
        Box(Modifier.fillMaxSize().windowInsetsPadding(insets)) {
            when (state) {
                FrameState.Closed -> Unit
                FrameState.Loading -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                is FrameState.Unavailable -> Unavailable(state.problem, onClose)
                is FrameState.Editing ->
                    FrameSheetContent(
                        kind = state.request.kind,
                        image = state.image,
                        base = state.base,
                        widthDp = windowWidthDp(),
                        saving = state.saving,
                        problem = state.problem,
                        onSave = onSave,
                        onCancel = onClose,
                        rules = rules,
                    )
            }
        }
    }
}

@Composable
private fun Unavailable(
    problem: Problem?,
    onClose: () -> Unit,
) {
    Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(GAP.dp)) {
        if (problem == null) {
            Text(
                stringResource(R.string.image_frames_no_master),
                color = Palette.fg,
                modifier = Modifier.testTag("frame-unavailable"),
            )
        } else {
            ProblemCard(problem, onClose)
        }
        Pill(stringResource(R.string.cancel), filled = false, onClick = onClose)
    }
}

/**
 * The crop sheet itself (decision 0086): the frame of this window's size class to drag and pinch, Save and Cancel,
 * and for a cover a quiet link to adjust the other two sizes. It reads no state of the app, so a test and a screenshot
 * drive it directly.
 */
@Composable
fun FrameSheetContent(
    kind: FrameKind,
    image: ImageBitmap,
    base: Framing?,
    widthDp: Int,
    onSave: (Framing) -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
    rules: FrameRules = CoreFrameRules,
    saving: Boolean = false,
    problem: Problem? = null,
    initiallyAdvanced: Boolean = false,
) {
    val size = remember(image) { ImageSize(image.width, image.height) }
    val edits = remember { mutableStateMapOf<Frame, FrameRect>() }
    var last by remember { mutableStateOf<Frame?>(null) }
    var cleared by remember { mutableStateOf(false) }
    var advanced by remember { mutableStateOf(initiallyAdvanced) }
    val device = rules.frameForWidth(kind, widthDp)
    // After a reset the stored overrides are gone, though the focus they were placed from stays.
    val effective = if (cleared && base != null) Framing(base.focus, emptyList()) else base
    val save = { onSave(FrameMath.framingOf(effective, edits, last)) }
    Column(
        modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(GAP.dp),
    ) {
        Text(
            stringResource(R.string.image_frames_title),
            color = Palette.fg,
            modifier = Modifier.testTag("frame-title"),
        )
        Text(stringResource(R.string.image_frames_hint), style = HINT, color = Palette.fg)
        val shown = if (advanced) rules.frames(kind) else listOf(device)
        // Side by side from the medium size class up, which the core defines (decision 0087).
        val sideBySide = advanced && rules.frameForWidth(FrameKind.COVER, widthDp) != Frame.COMPACT
        val panes: @Composable (Frame) -> Unit = { frame ->
            Pane(frame, kind, image, size, effective, edits, rules, labelled = advanced) { last = frame }
        }
        if (sideBySide) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(GAP.dp)) {
                shown.forEach { Box(Modifier.weight(1f)) { panes(it) } }
            }
        } else {
            shown.forEach { panes(it) }
        }
        if (kind == FrameKind.COVER) {
            AdvancedControls(
                open = advanced,
                onToggle = { advanced = !advanced },
                onReset = {
                    edits.clear()
                    last = null
                    cleared = true
                },
            )
        }
        problem?.let { ProblemCard(it, save) }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(GAP.dp)) {
            Pill(
                stringResource(R.string.cancel),
                filled = false,
                onClick = onCancel,
                modifier = Modifier.weight(1f).testTag("frame-cancel"),
            )
            Pill(
                stringResource(R.string.save),
                filled = true,
                onClick = save,
                enabled = !saving,
                modifier = Modifier.weight(1f).testTag("frame-save"),
            )
        }
    }
}

@Composable
private fun AdvancedControls(
    open: Boolean,
    onToggle: () -> Unit,
    onReset: () -> Unit,
) {
    TextButton(
        onClick = onToggle,
        modifier =
            Modifier.testTag("frame-advanced").semantics {
                val toggle: () -> Boolean = {
                    onToggle()
                    true
                }
                if (open) collapse(action = toggle) else expand(action = toggle)
            },
    ) { Text(stringResource(R.string.image_frames_advanced), color = Palette.fg) }
    if (open) {
        TextButton(onClick = onReset, modifier = Modifier.testTag("frame-reset")) {
            Text(stringResource(R.string.image_frames_reset), color = Palette.fg)
        }
    }
}

@Composable
private fun Pane(
    frame: Frame,
    kind: FrameKind,
    image: ImageBitmap,
    size: ImageSize,
    framing: Framing?,
    edits: SnapshotStateMap<Frame, FrameRect>,
    rules: FrameRules,
    labelled: Boolean,
    onEdit: () -> Unit,
) {
    val aspect = rules.aspect(kind, frame)
    val whole = remember(size, aspect) { FrameMath.whole(size, aspect, rules.place) }
    val stored = framing?.overrides?.firstOrNull { it.frame == frame }?.rect
    val rect = edits[frame] ?: FrameMath.start(size, aspect, framing?.focus ?: Focus(0.5, 0.5), stored, rules.place)
    val zoomLabel = stringResource(R.string.image_frames_zoom)

    fun edit(next: FrameRect) {
        edits[frame] = next
        onEdit()
    }
    Column(verticalArrangement = Arrangement.spacedBy(GAP.dp / 2)) {
        if (labelled) frameLabel(frame)?.let { Text(stringResource(it), style = HINT, color = Palette.fg) }
        Canvas(
            Modifier
                .then(if (frame == Frame.SQUARE) Modifier.widthIn(max = SQUARE_MAX_DP.dp) else Modifier)
                .fillMaxWidth()
                .aspectRatio(aspect.w.toFloat() / aspect.h)
                .clip(RoundedCornerShape(PANE_RADIUS.dp))
                .testTag("frame-pane-$frame")
                .pointerInput(frame, size, aspect) {
                    detectTransformGestures { centroid, pan, zoom, _ ->
                        val from = edits[frame] ?: rect
                        edit(transformed(from, size, aspect, Gesture(centroid, pan, zoom, this.size), rules.place))
                    }
                },
        ) {
            drawImage(
                image,
                srcOffset = IntOffset(Math.round(rect.x * size.w).toInt(), Math.round(rect.y * size.h).toInt()),
                srcSize = IntSize(Math.round(rect.w * size.w).toInt(), Math.round(rect.h * size.h).toInt()),
                dstSize = IntSize(this.size.width.toInt(), this.size.height.toInt()),
            )
        }
        val zoomNow = FrameMath.zoomOf(rect, whole).toFloat()
        Slider(
            value = zoomNow.coerceIn(1f, FrameMath.MAX_ZOOM.toFloat()),
            onValueChange = { target ->
                edit(FrameMath.zoom(rect, size, aspect, target / zoomNow.toDouble(), Anchor(0.5, 0.5), rules.place))
            },
            valueRange = 1f..FrameMath.MAX_ZOOM.toFloat(),
            modifier = Modifier.semantics { contentDescription = zoomLabel }.testTag("frame-zoom-$frame"),
        )
    }
}

private class Gesture(
    val centroid: Offset,
    val pan: Offset,
    val zoom: Float,
    val view: IntSize,
)

/** The rectangle after a gesture on the pane: dragged first, then zoomed about the fingers' centre. */
private fun transformed(
    rect: FrameRect,
    image: ImageSize,
    aspect: Aspect,
    gesture: Gesture,
    place: Placer,
): FrameRect {
    val w = gesture.view.width.toDouble()
    val h = gesture.view.height.toDouble()
    val dragged = FrameMath.drag(rect, gesture.pan.x.toDouble(), gesture.pan.y.toDouble(), w, h)
    if (gesture.zoom == 1f) return dragged
    val anchor = Anchor(gesture.centroid.x / w, gesture.centroid.y / h)
    return FrameMath.zoom(dragged, image, aspect, gesture.zoom.toDouble(), anchor, place)
}

private fun frameLabel(frame: Frame): Int? =
    when (frame) {
        Frame.COMPACT -> R.string.image_frames_compact
        Frame.MEDIUM -> R.string.image_frames_medium
        Frame.EXPANDED -> R.string.image_frames_expanded
        Frame.SQUARE -> null
    }
