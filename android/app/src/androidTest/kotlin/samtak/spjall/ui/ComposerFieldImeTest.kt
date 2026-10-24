package samtak.spjall.ui

import androidx.activity.ComponentActivity
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.assertIsNotFocused
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.Lifecycle
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertFalse
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ComposerFieldImeTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    /** Read on the main thread: the window's insets belong to the view hierarchy's own thread. */
    private fun imeVisible(): Boolean {
        var visible = false
        compose.runOnUiThread {
            val view = compose.activity.window.decorView
            visible = ViewCompat.getRootWindowInsets(view)?.isVisible(WindowInsetsCompat.Type.ime()) == true
        }
        return visible
    }

    private fun waitForIme(visible: Boolean) {
        compose.waitUntil(IME_TIMEOUT_MS) { imeVisible() == visible }
    }

    @Test
    fun theFieldGivesUpFocusWhenTheKeyboardIsClosedSoResumeDoesNotReopenIt() {
        // As MainActivity does: without edge-to-edge the window consumes the IME insets
        // before Compose sees them, so WindowInsets.isImeVisible never changes.
        compose.runOnUiThread { compose.activity.enableEdgeToEdge() }
        compose.setContent {
            var text by remember { mutableStateOf("") }
            ComposerField(
                value = text,
                onChange = { text = it },
                placeholder = "write",
                modifier = Modifier.testTag("field"),
            )
        }
        compose.onNodeWithTag("field").performClick()
        compose.onNodeWithTag("field").assertIsFocused()
        waitForIme(visible = true)

        compose.runOnUiThread {
            WindowInsetsControllerCompat(compose.activity.window, compose.activity.window.decorView)
                .hide(WindowInsetsCompat.Type.ime())
        }
        waitForIme(visible = false)

        compose.onNodeWithTag("field").assertIsNotFocused()

        val scenario = compose.activityRule.scenario
        scenario.moveToState(Lifecycle.State.CREATED)
        scenario.moveToState(Lifecycle.State.RESUMED)
        compose.waitForIdle()
        Thread.sleep(SETTLE_MS)
        assertFalse("the keyboard came back on resume", imeVisible())
    }
}

private const val IME_TIMEOUT_MS = 5_000L
private const val SETTLE_MS = 1_000L
