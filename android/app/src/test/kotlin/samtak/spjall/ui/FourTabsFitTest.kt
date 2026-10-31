package samtak.spjall.ui

import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import samtak.spjall.brand.R
import samtak.spjall.conversations.SCREENSHOT_SDK

/**
 * The bottom bar with the feed in front of the other three tabs (decision 0116): on the narrowest phones every name
 * stays whole and the bar stays inside the screen, also at a larger text size.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [SCREENSHOT_SDK], fontScale = 1f)
class FourTabsFitTest {
    @get:Rule val compose = createComposeRule()

    private fun four(): List<Tab> {
        val context = RuntimeEnvironment.getApplication()
        return listOf(
            Tab(AppIcons.Feed, context.getString(R.string.tab_feed), selected = true) {},
            Tab(AppIcons.Chat, context.getString(R.string.tab_conversations), selected = false) {},
            Tab(AppIcons.Communities, context.getString(R.string.tab_communities), selected = false) {},
            Tab(AppIcons.Person, context.getString(R.string.tab_me), selected = false) {},
        )
    }

    private fun fits(width: Int) {
        compose.setContent { SpjallTheme { TabBar(four()) } }
        assertEquals(emptyList<String>(), compose.wordsCut())
        val bounds = compose.onRoot().getBoundsInRoot()
        assertTrue(bounds.right - bounds.left <= width.dp)
    }

    @Test
    @Config(qualifiers = "w320dp-h640dp")
    fun fourTabsFitAt320() = fits(320)

    @Test
    @Config(qualifiers = "w360dp-h740dp")
    fun fourTabsFitAt360() = fits(360)

    @Test
    @Config(qualifiers = "w320dp-h640dp", fontScale = 1.5f)
    fun fourTabsFitAt320AndOneAndAHalfTheTextSize() = fits(320)
}
