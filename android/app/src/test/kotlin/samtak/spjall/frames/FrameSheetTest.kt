package samtak.spjall.frames

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import androidx.compose.ui.test.swipeUp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import samtak.spjall.conversations.SCREENSHOT_DEVICE
import samtak.spjall.conversations.SCREENSHOT_SDK
import samtak.spjall.core.Frame
import samtak.spjall.core.FrameKind
import samtak.spjall.core.Framing
import samtak.spjall.ui.SpjallTheme

/** The crop sheet's behaviour (decision 0086): what it shows for each kind, and what Save sends. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [SCREENSHOT_SDK], qualifiers = SCREENSHOT_DEVICE, fontScale = 1f)
class FrameSheetTest {
    @get:Rule val compose = createComposeRule()

    private val saved = mutableListOf<Framing>()
    private var cancelled = 0

    private fun show(
        kind: FrameKind,
        widthDp: Int = 400,
        base: Framing? = null,
    ) {
        compose.setContent {
            SpjallTheme {
                FrameSheetContent(
                    kind = kind,
                    image = bandedImage(),
                    base = base,
                    widthDp = widthDp,
                    onSave = { saved += it },
                    onCancel = { cancelled++ },
                    rules = FakeFrameRules,
                )
            }
        }
    }

    @Test
    fun aCoverShowsTheAdvancedLinkCollapsed() {
        show(FrameKind.COVER)
        compose.onNodeWithTag("frame-advanced").assertIsDisplayed()
        val config = compose.onNodeWithTag("frame-advanced").fetchSemanticsNode().config
        assertTrue("collapsed offers expand", SemanticsActions.Expand in config)
        assertTrue("collapsed has no collapse", SemanticsActions.Collapse !in config)
        compose.onNodeWithTag("frame-pane-COMPACT").assertIsDisplayed()
        compose.onNodeWithTag("frame-pane-MEDIUM").assertDoesNotExist()
        compose.onNodeWithTag("frame-pane-EXPANDED").assertDoesNotExist()
    }

    @Test
    fun aPhotoNeverShowsTheAdvancedLink() {
        show(FrameKind.PHOTO)
        compose.onNodeWithTag("frame-advanced").assertDoesNotExist()
        compose.onNodeWithTag("frame-pane-SQUARE").assertIsDisplayed()
    }

    @Test
    fun openingAdvancedShowsAllThreeFramesAndTheLinkExpandedState() {
        show(FrameKind.COVER)
        compose.onNodeWithTag("frame-advanced").performClick()
        compose.onNodeWithTag("frame-pane-COMPACT").assertExists()
        compose.onNodeWithTag("frame-pane-MEDIUM").assertExists()
        compose.onNodeWithTag("frame-pane-EXPANDED").assertExists()
        compose.onNodeWithTag("frame-reset").assertExists()
        val config = compose.onNodeWithTag("frame-advanced").fetchSemanticsNode().config
        assertTrue("open offers collapse", SemanticsActions.Collapse in config)
    }

    @Test
    fun theFramesStackOnAPhoneAndSitSideBySideFromSixHundredDp() {
        show(FrameKind.COVER, widthDp = 400)
        compose.onNodeWithTag("frame-advanced").performClick()
        val stacked = compose.onNodeWithTag("frame-pane-COMPACT").fetchSemanticsNode().positionInRoot
        val below = compose.onNodeWithTag("frame-pane-MEDIUM").fetchSemanticsNode().positionInRoot
        assertTrue("stacked: the second is lower", below.y > stacked.y)
        assertEquals(stacked.x, below.x, 0.5f)
    }

    @Test
    @Config(qualifiers = "w900dp-h900dp")
    fun sideBySideOnAWideWindow() {
        show(FrameKind.COVER, widthDp = 900)
        compose.onNodeWithTag("frame-advanced").performClick()
        val first = compose.onNodeWithTag("frame-pane-COMPACT").fetchSemanticsNode().positionInRoot
        val second = compose.onNodeWithTag("frame-pane-MEDIUM").fetchSemanticsNode().positionInRoot
        assertTrue("side by side: the second is to the right", second.x > first.x)
        assertEquals(first.y, second.y, 0.5f)
    }

    @Test
    fun saveSendsTheFramingAndCancelSendsNothing() {
        show(FrameKind.PHOTO)
        compose.onNodeWithTag("frame-pane-SQUARE").performTouchInput { swipeLeft() }
        compose.onNodeWithTag("frame-save").performClick()
        assertEquals(1, saved.size)
        assertTrue("the drag moved the focus", saved.single().focus.x > 0.5)
        compose.onNodeWithTag("frame-cancel").performClick()
        assertEquals(1, cancelled)
        assertEquals(1, saved.size)
    }

    @Test
    fun anAdjustedSizeBecomesAnOverrideAndResetDropsThem() {
        val base = Framing(samtak.spjall.core.Focus(0.5, 0.5), emptyList())
        show(FrameKind.COVER, base = base)
        compose.onNodeWithTag("frame-advanced").performClick()
        compose.onNodeWithTag("frame-pane-EXPANDED").performTouchInput { swipeLeft() }
        compose.onNodeWithTag("frame-save").performClick()
        assertEquals(listOf(Frame.EXPANDED), saved.single().overrides.map { it.frame })
        compose.onNodeWithTag("frame-reset").performClick()
        compose.onNodeWithTag("frame-save").performClick()
        assertTrue(saved.last().overrides.isEmpty())
    }

    @Test
    fun anAdvancedDragLeavesTheStoredFocusAlone() {
        val stored = samtak.spjall.core.Focus(0.5, 0.5)
        show(FrameKind.COVER, base = Framing(stored, emptyList()))
        compose.onNodeWithTag("frame-advanced").performClick()
        compose.onNodeWithTag("frame-pane-EXPANDED").performTouchInput { swipeUp() }
        compose.onNodeWithTag("frame-save").performClick()
        assertEquals(stored, saved.single().focus)
        assertEquals(listOf(Frame.EXPANDED), saved.single().overrides.map { it.frame })
    }
}
