package samtak.spjall.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import samtak.spjall.conversations.SCREENSHOT_DEVICE
import samtak.spjall.conversations.SCREENSHOT_SDK

/**
 * A long verified name never leaves the mark alone at the start of a line: at every width the mark sits on the
 * line of the name's last character. Where the last word and the mark together are wider than the box, some
 * break is forced and the width is skipped.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [SCREENSHOT_SDK], qualifiers = SCREENSHOT_DEVICE, fontScale = 1f)
class NameWithMarkTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun theMarkStaysOnTheLineOfTheLastWord() {
        val name = "Anna Margrét Sigurbjörnsdóttir Kristjánsdóttir"
        val widths = (120..360 step 4).toList()
        val layouts = HashMap<Int, TextLayoutResult>()
        val width = mutableIntStateOf(widths.first())
        lateinit var measurer: TextMeasurer
        lateinit var style: TextStyle
        compose.setContent {
            measurer = rememberTextMeasurer()
            SpjallTheme {
                style = MaterialTheme.typography.bodyLarge
                Box(Modifier.width(width.intValue.dp)) {
                    NameWithMark(
                        name = name,
                        verified = true,
                        style = style,
                        color = Color.Black,
                        onTextLayout = { layouts[width.intValue] = it },
                    )
                }
            }
        }
        val markPx = compose.density.run { 14.dp.toPx() }
        val spacePx = measurer.measure("\u00A0", style).size.width
        val lastWordAt = name.lastIndexOf(' ') + 1
        val failing = mutableListOf<String>()
        for (w in widths) {
            width.intValue = w
            compose.waitForIdle()
            val layout = layouts.getValue(w)
            val last = layout.getLineForOffset(name.length - 1)
            val mark = layout.getLineForOffset(name.length + 1)
            val lineWidth = layout.getLineRight(last) - layout.getLineLeft(last)
            val forced = layout.getLineStart(last) >= lastWordAt && lineWidth + spacePx + markPx > layout.size.width
            if (!forced && last != mark) failing += "${w}dp: last word on line $last, mark on line $mark"
        }
        assertTrue("the mark left the last word at: $failing", failing.isEmpty())
    }
}
