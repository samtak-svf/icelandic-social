package samtak.spjall.ui

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.ComposeContentTestRule
import androidx.compose.ui.text.TextLayoutResult
import kotlin.math.ceil

/**
 * The texts on screen that do not fit their box: one narrower than the text's longest word cuts that word, and
 * one narrower than the whole text cuts it when the text may not wrap. Each text on its own: a merged node, a
 * tab or a button, holds several and is as wide as all of them. Empty when every word shows whole.
 */
fun ComposeContentTestRule.wordsCut(): List<String> =
    onAllNodes(hasText("", substring = true), useUnmergedTree = true).fetchSemanticsNodes().mapNotNull { node ->
        val layouts = mutableListOf<TextLayoutResult>()
        node.config
            .getOrNull(SemanticsActions.GetTextLayoutResult)
            ?.action
            ?.invoke(layouts)
        val layout = layouts.firstOrNull() ?: return@mapNotNull null
        val intrinsics = layout.multiParagraph.intrinsics
        val needs =
            if (layout.layoutInput.maxLines == 1 || !layout.layoutInput.softWrap) {
                intrinsics.maxIntrinsicWidth
            } else {
                intrinsics.minIntrinsicWidth
            }
        layout.layoutInput.text.text
            .takeIf { node.size.width < ceil(needs) }
    }
